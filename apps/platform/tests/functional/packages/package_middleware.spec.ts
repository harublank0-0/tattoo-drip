import { randomUUID } from "node:crypto";
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import PilotGrantService from "#modules/packages/services/pilot_grant_service";
import TattooProject from "#modules/projects/models/tattoo_project";
import type Tenant from "#modules/tenancy/models/tenant";
import { dbClient } from "#services/db_context";
import env from "#start/env";
import { captureLogs } from "#tests/helpers/logs";
import {
	makeArtist,
	makeClient,
	makeInquiry,
	makeProject,
} from "#tests/helpers/pipeline";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";

/**
 * Paused rules (studio packages, phase 3): the packages middleware refuses
 * new client work and Design Lab generation for a paused studio in enforce
 * mode, and only logs in observe mode (the default). Everything on an
 * existing project goes on.
 */

const PAUSED_NEW_WORK =
	"Starting new client work is paused until your package is paid. Your existing projects, bookings, payments and page keep working.";
const PAUSED_DESIGN_LAB =
	"Design Lab is paused until your package is paid. Your saved concepts stay available.";

/** Moves the workspace's creation back: its trial is long over and it never paid. */
const pause = (tenant: Tenant) =>
	inTenant(tenant, () =>
		dbClient().rawQuery("update tenants set created_at = ? where id = ?", [
			"2025-01-01T00:00:00Z",
			tenant.id,
		]),
	);

async function studio(slug: string, paused = true) {
	const made = await studioWithOwner(slug, slug);
	if (paused) await pause(made.tenant);
	const { inquiry, artist } = await inTenant(made.tenant, async () => {
		const artist = await makeArtist(made.tenant);
		const inquiry = await makeInquiry(
			made.tenant,
			await makeClient(made.tenant),
		);
		return { inquiry, artist };
	});
	return { ...made, inquiry, artist };
}

const projectsOf = (tenant: Tenant, inquiryId: string) =>
	inTenant(tenant, () => TattooProject.query().where("inquiry_id", inquiryId));

test.group("Packages: refusing new client work while paused", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.teardown(() => {
		// env.set also writes process.env, which later specs' child processes
		// inherit: leave it unset.
		env.set("PACKAGE_ENFORCEMENT", undefined as never);
		delete process.env.PACKAGE_ENFORCEMENT;
	});

	test("in enforce mode a paused studio can't accept an inquiry or open the booking page; the owner lands on Billing", async ({
		client,
		assert,
	}) => {
		env.set("PACKAGE_ENFORCEMENT", "enforce");
		const { owner, tenant, inquiry, artist } = await studio("mw-paused");
		const billing = `/t/${tenant.slug}/settings/billing`;

		const accept = await client
			.post(`/t/${tenant.slug}/inbox/${inquiry.id}/accept`)
			.form({ artistId: artist.id })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);
		accept.assertHeader("location", billing);
		accept.assertFlashMessage("error", PAUSED_NEW_WORK);
		assert.lengthOf(await projectsOf(tenant, inquiry.id), 0);

		const booking = await client
			.get(`/t/${tenant.slug}/projects/new`)
			.loginAs(owner)
			.redirects(0);
		booking.assertHeader("location", billing);
	});

	test("in enforce mode a paused studio's existing work goes on", async ({
		client,
		assert,
	}) => {
		env.set("PACKAGE_ENFORCEMENT", "enforce");
		const { owner, tenant, artist } = await studio("mw-existing");
		const project = await inTenant(tenant, async () =>
			makeProject(tenant, await makeClient(tenant), {
				status: "booked",
				artistId: artist.id,
			}),
		);
		const projectUrl = `/t/${tenant.slug}/projects/${project.id}`;

		const notes = await client
			.put(`${projectUrl}/notes`)
			.form({ notes: "Second session next month." })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);
		notes.assertFlashMessage("success", "Notes saved.");

		const session = await client
			.post(`${projectUrl}/sessions`)
			.form({
				sessionKind: "tattoo",
				sessionArtistId: artist.id,
				date: DateTime.now()
					.setZone("Asia/Kathmandu")
					.plus({ days: 5 })
					.toFormat("yyyy-MM-dd"),
				startTime: "10:00",
				hours: "2",
			})
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);
		session.assertHeader("location", projectUrl);
		assert.notInclude(
			JSON.stringify(session.body()),
			"paused until your package is paid",
		);
	});

	test("in enforce mode Design Lab generation is refused while paused", async ({
		client,
	}) => {
		env.set("PACKAGE_ENFORCEMENT", "enforce");
		const { owner, tenant } = await studio("mw-lab");

		const response = await client
			.post(`/t/${tenant.slug}/design-lab/${randomUUID()}/generations`)
			.form({})
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);
		response.assertHeader("location", `/t/${tenant.slug}/settings/billing`);
		response.assertFlashMessage("error", PAUSED_DESIGN_LAB);
	});

	test("an artist member of a paused studio goes back, not to Billing", async ({
		client,
	}) => {
		env.set("PACKAGE_ENFORCEMENT", "enforce");
		const { tenant } = await studio("mw-artist");
		const member = await artistIn(tenant, "artist@mw-artist.example");
		const from = `/t/${tenant.slug}/projects`;

		const response = await client
			.get(`/t/${tenant.slug}/projects/new`)
			.header("referer", from)
			.loginAs(member)
			.redirects(0);
		response.assertHeader("location", from);
		response.assertFlashMessage("error", PAUSED_NEW_WORK);
	});

	test("an artist refused on the refused page itself, or with no referer, goes to the studio's home, never in a loop", async ({
		client,
	}) => {
		env.set("PACKAGE_ENFORCEMENT", "enforce");
		const { tenant } = await studio("mw-artist-loop");
		const member = await artistIn(tenant, "artist@mw-artist-loop.example");
		const booking = `/t/${tenant.slug}/projects/new`;

		// A stale booking page: its own lookup form sends it here again.
		const stale = await client
			.get(`${booking}?phone=9800000000`)
			.header("referer", `http://localhost${booking}`)
			.loginAs(member)
			.redirects(0);
		stale.assertHeader("location", `/t/${tenant.slug}`);
		stale.assertFlashMessage("error", PAUSED_NEW_WORK);

		// A bookmark: no referer at all.
		const bookmarked = await client.get(booking).loginAs(member).redirects(0);
		bookmarked.assertHeader("location", `/t/${tenant.slug}`);
	});

	test("in observe mode nothing is refused; the rule is logged with its route", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, inquiry, artist } = await studio("mw-observe");
		const logs = captureLogs();
		try {
			const accept = await client
				.post(`/t/${tenant.slug}/inbox/${inquiry.id}/accept`)
				.form({ artistId: artist.id })
				.withCsrfToken()
				.loginAs(owner)
				.redirects(0);
			accept.assertFlashMessage(
				"success",
				"Inquiry accepted: project created.",
			);
			assert.lengthOf(await projectsOf(tenant, inquiry.id), 1);
			const logged = logs
				.everything()
				.filter((args) => args.includes("Package rule would refuse"));
			assert.lengthOf(logged, 1);
			assert.deepInclude(logged[0][0] as Record<string, unknown>, {
				tenantId: tenant.id,
				rule: "paused_new_work",
				route: "tenant.inbox.accept",
			});
		} finally {
			logs.restore();
		}
	});

	test("a pilot or trial studio in enforce mode is never refused", async ({
		client,
		assert,
	}) => {
		env.set("PACKAGE_ENFORCEMENT", "enforce");
		const trial = await studio("mw-trial", false);
		const pilot = await studio("mw-pilot");
		await new PilotGrantService().grant(
			"mw-pilot",
			{
				package: "studio",
				endsAt: DateTime.utc().plus({ months: 3 }),
				note: "Design partner",
				grantedBy: "Ops",
			},
			DateTime.utc().minus({ minutes: 1 }),
		);

		for (const { owner, tenant, inquiry, artist } of [trial, pilot]) {
			const accept = await client
				.post(`/t/${tenant.slug}/inbox/${inquiry.id}/accept`)
				.form({ artistId: artist.id })
				.withCsrfToken()
				.loginAs(owner)
				.redirects(0);
			accept.assertFlashMessage(
				"success",
				"Inquiry accepted: project created.",
			);
			assert.lengthOf(await projectsOf(tenant, inquiry.id), 1, tenant.slug);
		}
	});
});
