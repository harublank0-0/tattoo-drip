import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import type { ProjectStatus } from "#modules/projects/models/tattoo_project";
import { makeClient, makeProject, makeQuote } from "#tests/helpers/pipeline";
import { sql } from "#tests/helpers/sql";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

type TenantRef = { id: string };
type Candidate = { tenant_id: string; project_id: string; quote_id: string };

/**
 * The function's rows for these tenants only. It sees every tenant's
 * committed rows, and locally the tests share the dev database.
 */
async function candidatesOf(...tenants: TenantRef[]) {
	const ids = new Set(tenants.map(({ id }) => id));
	const { rows } = await sql(
		{},
		"select * from public.expired_quote_candidates()",
	);
	return (rows as Candidate[]).filter(({ tenant_id }) => ids.has(tenant_id));
}

/** A project in `status` whose only quote expires at `expiresAt`. */
function projectWithQuote(
	tenant: TenantRef,
	status: ProjectStatus,
	expiresAt: DateTime,
) {
	return inTenant(tenant, async () => {
		const project = await makeProject(tenant, await makeClient(tenant), {
			status,
		});
		const quote = await makeQuote(tenant, project, { expiresAt });
		return { project, quote };
	});
}

const hourAgo = () => DateTime.utc().minus({ hours: 1 });

const rowOf = (
	tenant: TenantRef,
	{ project, quote }: { project: { id: string }; quote: { id: string } },
): Candidate => ({
	tenant_id: tenant.id,
	project_id: project.id,
	quote_id: quote.id,
});

test.group("expired_quote_candidates()", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("lists every tenant's expired current quotes as ids, though the app role alone sees no project", async ({
		assert,
	}) => {
		const a = await studioWithOwner("studio-a", "Studio A");
		const b = await studioWithOwner("studio-b", "Studio B");
		const quoted = await projectWithQuote(a.tenant, "quoted", hourAgo());
		const pending = await projectWithQuote(
			b.tenant,
			"deposit_pending",
			hourAgo(),
		);
		const held = await projectWithQuote(b.tenant, "on_hold", hourAgo());

		const { rows } = await sql(
			{},
			"select count(*)::int as n from tattoo_projects",
		);
		assert.equal(rows[0].n, 0);

		assert.sameDeepMembers(await candidatesOf(a.tenant, b.tenant), [
			rowOf(a.tenant, quoted),
			rowOf(b.tenant, pending),
			rowOf(b.tenant, held),
		]);
	});

	test("lists a quote only between 2 minutes and 24 hours after its expiry", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		await projectWithQuote(tenant, "quoted", DateTime.utc().plus({ hours: 1 }));
		await projectWithQuote(
			tenant,
			"quoted",
			DateTime.utc().minus({ seconds: 30 }),
		);
		await projectWithQuote(tenant, "quoted", DateTime.utc().minus({ days: 2 }));
		const inside = await projectWithQuote(
			tenant,
			"quoted",
			DateTime.utc().minus({ hours: 23 }),
		);

		assert.deepEqual(await candidatesOf(tenant), [rowOf(tenant, inside)]);
	});

	test("leaves out revised quotes, deleted projects and statuses expiry never cancels", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		// Revised: v1 expired, v2 is current and still valid.
		const revised = await projectWithQuote(
			tenant,
			"quoted",
			DateTime.utc().minus({ hours: 2 }),
		);
		await inTenant(tenant, () =>
			makeQuote(tenant, revised.project, {
				version: 2,
				expiresAt: DateTime.utc().plus({ days: 7 }),
			}),
		);

		// Both versions expired: only v2 is current.
		const twice = await projectWithQuote(
			tenant,
			"quoted",
			DateTime.utc().minus({ hours: 3 }),
		);
		const v2 = await inTenant(tenant, () =>
			makeQuote(tenant, twice.project, { version: 2, expiresAt: hourAgo() }),
		);

		await inTenant(tenant, async () => {
			const gone = await makeProject(tenant, await makeClient(tenant), {
				status: "quoted",
			});
			await makeQuote(tenant, gone, { expiresAt: hourAgo() });
			await gone.softDelete();
		});

		for (const status of [
			"reviewing",
			"booked",
			"in_progress",
			"completed",
			"healing_check",
			"declined",
			"cancelled",
		] as const) {
			await projectWithQuote(tenant, status, hourAgo());
		}

		assert.deepEqual(await candidatesOf(tenant), [
			rowOf(tenant, { project: twice.project, quote: v2 }),
		]);
	});

	test("only the app role may call it, and it runs as its owner with a pinned search_path and no arguments", async ({
		assert,
	}) => {
		const { rows } = await sql(
			{},
			`select p.prosecdef as definer,
			        p.proconfig,
			        pg_get_function_arguments(p.oid) as args,
			        pg_get_function_result(p.oid) as result,
			        has_function_privilege('public', p.oid, 'execute') as public_can_run,
			        has_function_privilege(current_user, p.oid, 'execute') as app_can_run,
			        pg_get_userbyid(p.proowner) <> current_user as owned_by_another_role
			 from pg_proc p
			 where p.oid = 'public.expired_quote_candidates()'::regprocedure`,
		);

		assert.deepEqual(rows, [
			{
				definer: true,
				proconfig: ["search_path=pg_catalog, pg_temp"],
				args: "",
				result: "TABLE(tenant_id uuid, project_id uuid, quote_id uuid)",
				public_can_run: false,
				app_can_run: true,
				owned_by_another_role: true,
			},
		]);
	});
});
