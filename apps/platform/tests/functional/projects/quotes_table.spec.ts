import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import Quote, { QUOTE_KINDS } from "#modules/projects/models/quote";
import { withDbContext, withTransaction } from "#services/db_context";
import { makeClient, makeProject, makeQuote } from "#tests/helpers/pipeline";
import { assertRowLevelSecurity } from "#tests/helpers/rls";
import { insertRow } from "#tests/helpers/sql";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

const newQuote = (
	tenantId: string,
	projectId: string,
	over: Record<string, unknown> = {},
) => ({
	tenant_id: tenantId,
	project_id: projectId,
	version: 1,
	kind: "fixed",
	fixed_price: 1_000_000,
	deposit_amount: 200_000,
	expires_at: new Date("2030-01-01T00:00:00Z"),
	...over,
});

/** An hourly quote: NPR 5,000 an hour for 150 minutes, a total of 1,250,000 paisa. */
const hourly = (over: Record<string, unknown> = {}) => ({
	kind: "hourly",
	fixed_price: null,
	hourly_rate: 500_000,
	estimated_minutes: 150,
	...over,
});

const projectIn = (tenant: { id: string }) =>
	inTenant(tenant, async () => makeProject(tenant, await makeClient(tenant)));

async function twoTenants() {
	const { tenant: a } = await studioWithOwner("studio-a", "Studio A");
	const { tenant: b } = await studioWithOwner("studio-b", "Studio B");
	return { a, b, mine: await projectIn(a), theirs: await projectIn(b) };
}

test.group("quotes table", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a fixed quote has a price only, an hourly quote a rate and minutes only", async ({
		assert,
	}) => {
		const { a, mine } = await twoTenants();
		const rejects = (over: Record<string, unknown>) =>
			assert.rejects(
				() =>
					withTransaction((inner) =>
						insertRow(inner, "quotes", newQuote(a.id, mine.id, over)),
					),
				/quotes_kind_columns/,
			);

		await withDbContext({ tenantId: a.id }, async (trx) => {
			await rejects({ hourly_rate: 500_000 });
			await rejects({ estimated_minutes: 60 });
			await rejects({ fixed_price: null });
			await rejects(hourly({ fixed_price: 1_000_000 }));
			await rejects(hourly({ estimated_minutes: null }));
			await rejects(hourly({ hourly_rate: null }));
			await insertRow(trx, "quotes", newQuote(a.id, mine.id));
			await insertRow(
				trx,
				"quotes",
				newQuote(a.id, mine.id, hourly({ version: 2 })),
			);
		});
	});

	test("prices, rate, minutes and the version are positive and the deposit is not negative", async ({
		assert,
	}) => {
		const { a, mine } = await twoTenants();
		const rejects = (over: Record<string, unknown>, message: RegExp) =>
			assert.rejects(
				() =>
					withTransaction((inner) =>
						insertRow(inner, "quotes", newQuote(a.id, mine.id, over)),
					),
				message,
			);

		await withDbContext({ tenantId: a.id }, async () => {
			await rejects(
				{ fixed_price: 0, deposit_amount: 0 },
				/quotes_amounts_positive/,
			);
			await rejects(
				hourly({ hourly_rate: 0, deposit_amount: 0 }),
				/quotes_amounts_positive/,
			);
			await rejects(
				hourly({ estimated_minutes: 0, deposit_amount: 0 }),
				/quotes_amounts_positive/,
			);
			await rejects({ deposit_amount: -1 }, /quotes_amounts_positive/);
			await rejects({ version: 0 }, /quotes_version_positive/);
			await rejects({ kind: "weekly" }, /quotes_kind_check/);
		});
	});

	test("the deposit may be zero and never exceeds the total", async ({
		assert,
	}) => {
		const { a, mine } = await twoTenants();
		const rejects = (over: Record<string, unknown>) =>
			assert.rejects(
				() =>
					withTransaction((inner) =>
						insertRow(inner, "quotes", newQuote(a.id, mine.id, over)),
					),
				/quotes_deposit_within_total/,
			);

		await withDbContext({ tenantId: a.id }, async (trx) => {
			await rejects({ deposit_amount: 1_000_001 });
			await rejects(hourly({ deposit_amount: 1_250_001 }));
			await insertRow(
				trx,
				"quotes",
				newQuote(a.id, mine.id, { deposit_amount: 0 }),
			);
			await insertRow(
				trx,
				"quotes",
				newQuote(a.id, mine.id, { version: 2, deposit_amount: 1_000_000 }),
			);
			await insertRow(
				trx,
				"quotes",
				newQuote(
					a.id,
					mine.id,
					hourly({ version: 3, deposit_amount: 1_250_000 }),
				),
			);
		});
	});

	test("a project's versions are unique, and another project can reuse them", async ({
		assert,
	}) => {
		const { a, mine } = await twoTenants();
		const other = await projectIn(a);

		await withDbContext({ tenantId: a.id }, async (trx) => {
			await insertRow(trx, "quotes", newQuote(a.id, mine.id));
			await assert.rejects(
				() =>
					withTransaction((inner) =>
						insertRow(inner, "quotes", newQuote(a.id, mine.id)),
					),
				/quotes_project_version_unique/,
			);
			await insertRow(trx, "quotes", newQuote(a.id, mine.id, { version: 2 }));
			await insertRow(trx, "quotes", newQuote(a.id, other.id));
		});
	});

	test("a quote links only to its own tenant's project, and a project with a quote cannot be hard-deleted", async ({
		assert,
	}) => {
		const { a, mine, theirs } = await twoTenants();

		await withDbContext({ tenantId: a.id }, async (trx) => {
			await assert.rejects(
				() =>
					withTransaction((inner) =>
						insertRow(inner, "quotes", newQuote(a.id, theirs.id)),
					),
				/quotes_tenant_id_project_id_foreign/,
			);
			await insertRow(trx, "quotes", newQuote(a.id, mine.id));
			await assert.rejects(
				() =>
					withTransaction((inner) =>
						inner.rawQuery("delete from tattoo_projects where id = ?", [
							mine.id,
						]),
					),
				/quotes_tenant_id_project_id_foreign/,
			);
		});
	});

	test("row-level security", async ({ assert }) => {
		await assertRowLevelSecurity(assert, "quotes", async (tenant) =>
			newQuote(tenant.id, (await projectIn(tenant)).id),
		);
	});
});

test.group("Quote model", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("stores a fixed and an hourly quote", async ({ assert }) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const project = await makeProject(tenant, await makeClient(tenant));
			const fixed = await makeQuote(tenant, project);
			const perHour = await makeQuote(tenant, project, {
				version: 2,
				kind: "hourly",
				fixedPrice: null,
				hourlyRate: 500_000,
				estimatedMinutes: 150,
				depositAmount: 0,
			});

			const reloaded = await Quote.findOrFail(perHour.id);
			assert.equal(reloaded.kind, "hourly");
			assert.equal(reloaded.hourlyRate, 500_000);
			assert.equal(reloaded.estimatedMinutes, 150);
			assert.isNull(reloaded.fixedPrice);
			assert.equal(reloaded.currency, "NPR");
			assert.isTrue(reloaded.expiresAt > DateTime.utc());
			assert.equal((await Quote.findOrFail(fixed.id)).fixedPrice, 1_500_000);
		});
	});

	test("the current quote is the project's highest version, and quotes cannot be soft-deleted", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const project = await makeProject(tenant, await makeClient(tenant));
			await makeQuote(tenant, project, { version: 1 });
			const second = await makeQuote(tenant, project, {
				version: 2,
				fixedPrice: 1_800_000,
			});

			const current = await Quote.query()
				.where("project_id", project.id)
				.orderBy("version", "desc")
				.firstOrFail();

			assert.equal(current.id, second.id);
			assert.isUndefined(
				(Quote.prototype as unknown as Record<string, unknown>).softDelete,
			);
		});
	});

	test("every quote kind in the model is accepted by the database", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const project = await makeProject(tenant, await makeClient(tenant));
			let version = 0;
			for (const kind of QUOTE_KINDS) {
				version += 1;
				await makeQuote(
					tenant,
					project,
					kind === "fixed"
						? { version }
						: {
								version,
								kind,
								fixedPrice: null,
								hourlyRate: 500_000,
								estimatedMinutes: 90,
							},
				);
			}
			assert.lengthOf(
				await Quote.query().where("project_id", project.id),
				QUOTE_KINDS.length,
			);
		});
	});
});
