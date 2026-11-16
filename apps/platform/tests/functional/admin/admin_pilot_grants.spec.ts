import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import { operatorName } from "#controllers/admin_studios_controller";
import PilotGrantService from "#modules/packages/services/pilot_grant_service";
import { formatDay } from "#modules/projects/quotes";
import type Tenant from "#modules/tenancy/models/tenant";
import TenancyService from "#modules/tenancy/services/tenancy_service";
import { adminUser } from "#tests/helpers/admin";
import { send } from "#tests/helpers/discover";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";
import { assertValidationError } from "#tests/helpers/validation";

/**
 * Pilot grants from the studio's admin page
 * (docs/superpowers/specs/2026-11-16-admin-pilot-grants-design.md): the
 * Package section shows the studio's state and grants, gives a grant through
 * the same service as `packages:pilot`, and ends a running one early.
 */
test.group("Admin pilot grants", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	const pilots = new PilotGrantService();
	const grantsOf = (tenant: Tenant) =>
		inTenant(tenant, () => pilots.forTenant(tenant));
	const running = async (tenant: Tenant) => {
		const now = DateTime.utc();
		return (await grantsOf(tenant)).filter(
			(grant) => grant.startsAt <= now && grant.endsAt > now,
		);
	};
	const dayAhead = (days: number) =>
		DateTime.utc().plus({ days }).toISODate() as string;

	test("the studio page shows its package state, running grant and past grants", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner("pg-show", "PG Show");
		const now = DateTime.utc().startOf("second");
		const grant = (note: string, at: DateTime) =>
			pilots.grant(
				"pg-show",
				{
					package: "studio",
					endsAt: now.plus({ months: 3 }),
					note,
					grantedBy: "Ops",
				},
				at,
			);
		await grant("First agreement", now.minus({ days: 2 }));
		await grant("Extended", now.minus({ days: 1 }));

		const page = await client
			.get(`/admin/studios/${tenant.slug}`)
			.loginAs(await adminUser())
			.withInertia();
		// biome-ignore lint/suspicious/noExplicitAny: the page's props, read as the page reads them
		const pilot = (page.inertiaProps as any).pilot;

		assert.match(pilot.stateText, /^Studio, pilot until /);
		assert.equal(pilot.running.note, "Extended");
		assert.equal(pilot.running.grantedBy, "Ops");
		assert.lengthOf(pilot.past, 1);
		assert.equal(pilot.past[0].note, "First agreement");
		// A replaced grant ended when the next began, not on its planned day.
		assert.equal(
			pilot.past[0].endedText,
			now.minus({ days: 1 }).toFormat("yyyy-MM-dd HH:mm 'UTC'"),
		);
		assert.isNull(pilot.running.endedText);
		assert.deepEqual(
			pilot.packages.map((option: { value: string }) => option.value),
			["solo", "studio"],
		);
		// Extending a Studio pilot starts on Studio, never quietly on Solo.
		assert.equal(pilot.defaultPackage, "studio");
	});

	test("with no grant running, the form starts on no package", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner("pg-fresh", "PG Fresh");
		const page = await client
			.get(`/admin/studios/${tenant.slug}`)
			.loginAs(await adminUser())
			.withInertia();
		// biome-ignore lint/suspicious/noExplicitAny: the page's props, read as the page reads them
		const pilot = (page.inertiaProps as any).pilot;
		assert.isNull(pilot.running);
		assert.isNull(pilot.defaultPackage);
	});

	test("the admin gives a grant: ends at 00:00 UTC on the day, recorded by the admin", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner("pg-give", "PG Give");
		const until = dayAhead(30);

		const response = await send(
			client,
			await adminUser(),
			"post",
			"/admin/studios/pg-give/pilot",
			{ package: "solo", until, note: "Design partner" },
		);

		response.assertStatus(302);
		response.assertFlashMessage(
			"success",
			`PG Give is a Solo pilot until ${formatDay(until)}.`,
		);
		const [grant] = await running(tenant);
		assert.equal(grant.package, "solo");
		assert.equal(
			grant.endsAt.toMillis(),
			DateTime.fromISO(until, { zone: "utc" }).toMillis(),
		);
		assert.equal(grant.note, "Design partner");
		assert.equal(grant.grantedBy, "admin@platform.example");
	});

	test("records the admin by name, else by email cut to 100 characters", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner("pg-name", "PG Name");
		const admin = await adminUser();
		admin.fullName = "Ops Person";
		await admin.save();

		(
			await send(client, admin, "post", "/admin/studios/pg-name/pilot", {
				package: "studio",
				until: dayAhead(10),
				note: "Named",
			})
		).assertStatus(302);

		assert.equal((await running(tenant))[0].grantedBy, "Ops Person");
		// Only one address may be an admin in tests, so the long-email case is
		// checked on the name the page records.
		const long = `${"a".repeat(108)}@example.com`;
		assert.equal(
			operatorName({ fullName: null, email: long }),
			long.slice(0, 100),
		);
		assert.equal(
			operatorName({ fullName: "  ", email: "ops@example.com" }),
			"ops@example.com",
		);
	});

	test("a new grant replaces the running one", async ({ client, assert }) => {
		const { tenant } = await studioWithOwner("pg-replace", "PG Replace");
		const admin = await adminUser();
		for (const note of ["First", "Second"]) {
			(
				await send(client, admin, "post", "/admin/studios/pg-replace/pilot", {
					package: "studio",
					until: dayAhead(20),
					note,
				})
			).assertStatus(302);
		}

		const grants = await grantsOf(tenant);
		assert.lengthOf(grants, 2);
		assert.isAtMost(grants[0].endsAt.toMillis(), grants[1].startsAt.toMillis());
		const now = await running(tenant);
		assert.lengthOf(now, 1);
		assert.equal(now[0].note, "Second");
	});

	test("the admin ends the running grant", async ({ client, assert }) => {
		const { tenant } = await studioWithOwner("pg-end", "PG End");
		await pilots.grant("pg-end", {
			package: "studio",
			endsAt: DateTime.utc().plus({ months: 2 }),
			note: "Converting",
			grantedBy: "Ops",
		});

		const response = await send(
			client,
			await adminUser(),
			"post",
			"/admin/studios/pg-end/pilot/end",
		);

		response.assertStatus(302);
		response.assertFlashMessage(
			"success",
			"The pilot grant has ended. The studio's package now follows its payments.",
		);
		assert.lengthOf(await running(tenant), 0);
		assert.lengthOf(await grantsOf(tenant), 1);
	});

	test("refuses a past or impossible date and an empty note", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner("pg-refuse", "PG Refuse");
		const admin = await adminUser();
		const post = (body: Record<string, unknown>) =>
			send(client, admin, "post", "/admin/studios/pg-refuse/pilot", {
				package: "studio",
				note: "Valid note",
				...body,
			});

		const past = await post({ until: dayAhead(-1) });
		past.assertStatus(302);
		past.assertFlashMessage("error", "The grant must end after now.");

		const impossible = await post({ until: "2026-02-30" });
		impossible.assertStatus(302);
		impossible.assertFlashMessage("error", "Give an until date as YYYY-MM-DD.");

		assertValidationError(
			await post({ until: dayAhead(10), note: "   " }),
			"note",
		);
		assert.lengthOf(await grantsOf(tenant), 0);
	});

	test("ending with no running grant shows the error, not a 500", async ({
		client,
	}) => {
		await studioWithOwner("pg-none", "PG None");
		const response = await send(
			client,
			await adminUser(),
			"post",
			"/admin/studios/pg-none/pilot/end",
		);
		response.assertStatus(302);
		response.assertFlashMessage("error", "This studio has no running grant.");
	});

	test("an old slug grants to the same studio", async ({ client, assert }) => {
		const { tenant } = await studioWithOwner("pg-old", "PG Old");
		await inTenant(tenant, () =>
			new TenancyService().changeSlug(tenant, "pg-new"),
		);

		(
			await send(
				client,
				await adminUser(),
				"post",
				"/admin/studios/pg-old/pilot",
				{
					package: "solo",
					until: dayAhead(15),
					note: "Old link",
				},
			)
		).assertStatus(302);

		const [grant] = await running(tenant);
		assert.equal(grant.tenantId, tenant.id);
		assert.equal(grant.note, "Old link");
	});

	test("a studio owner gets a 404 and nothing is written", async ({
		client,
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner("pg-owner", "PG Owner");
		(
			await send(client, owner, "post", "/admin/studios/pg-owner/pilot", {
				package: "studio",
				until: dayAhead(10),
				note: "Self-granted",
			})
		).assertStatus(404);
		(
			await send(client, owner, "post", "/admin/studios/pg-owner/pilot/end")
		).assertStatus(404);
		assert.lengthOf(await grantsOf(tenant), 0);
	});

	test("the Billing page links each studio to its admin page", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner("pg-billing", "PG Billing");
		const page = await client
			.get("/admin/billing")
			.loginAs(await adminUser())
			.withInertia();
		const studios = page.inertiaProps.studios as {
			tenantId: string;
			slug: string;
		}[];
		assert.equal(
			studios.find((studio) => studio.tenantId === tenant.id)?.slug,
			"pg-billing",
		);
	});
});
