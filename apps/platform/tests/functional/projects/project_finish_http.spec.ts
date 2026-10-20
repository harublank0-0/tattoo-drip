import testUtils from "@adonisjs/core/services/test_utils";
import type { ApiClient } from "@japa/api-client";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import type User from "#models/user";
import type Artist from "#modules/artists/models/artist";
import TattooProject, {
	type ProjectStatus,
} from "#modules/projects/models/tattoo_project";
import type Tenant from "#modules/tenancy/models/tenant";
import {
	makeArtist,
	makeClient,
	makePayment,
	makeProject,
	makeQuote,
	makeSession,
} from "#tests/helpers/pipeline";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";
import { assertValidationError } from "#tests/helpers/validation";

const SLUG = "finish-desk-111";
const url = (id: string, action = "") => `/t/${SLUG}/projects/${id}${action}`;

/**
 * When the tattoo sessions of these tests end: 10:00 UTC on 10 Oct 2026,
 * 15:45 in Kathmandu, so a healing check is due 7 Nov 2026.
 */
const LAST_SESSION_END = DateTime.utc(2026, 10, 10, 10);

/** A studio, its owner, and Asha, an artist member linked to the profile Sita. */
async function setup() {
	const { owner, tenant } = await studioWithOwner(SLUG, "Finish Desk");
	const asha = await artistIn(tenant, `asha@${SLUG}.example`);
	const sita = await inTenant(tenant, async () => {
		const profile = await makeArtist(tenant);
		profile.userId = asha.id;
		await profile.save();
		return profile;
	});
	return { owner, tenant, asha, sita };
}

/**
 * A project in `status` assigned to Sita, whose two-hour tattoo session
 * ended at `endsAt` (give each project of a test its own time).
 */
function workDone(
	tenant: Tenant,
	sita: Artist,
	status: ProjectStatus = "in_progress",
	endsAt: DateTime = LAST_SESSION_END,
) {
	return inTenant(tenant, async () => {
		const project = await makeProject(tenant, await makeClient(tenant), {
			status,
			artistId: sita.id,
		});
		await makeSession(tenant, project, sita, {
			startsAt: endsAt.minus({ hours: 2 }),
			endsAt,
			status: "completed",
		});
		return project;
	});
}

const statusOf = (tenant: Tenant, project: TattooProject) =>
	inTenant(
		tenant,
		async () => (await TattooProject.findOrFail(project.id)).status,
	);

function post(
	client: ApiClient,
	path: string,
	user: User,
	body: Record<string, unknown> = { confirmedDue: "0" },
) {
	return client
		.post(path)
		.form(body)
		.withCsrfToken()
		.loginAs(user)
		.redirects(0);
}

test.group("Finishing a project over HTTP (TAT-111)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an owner marks the tattoo finished, then closes the healing check", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, sita } = await setup();
		const project = await workDone(tenant, sita);

		const finished = await post(client, url(project.id, "/finish"), owner);
		finished.assertHeader("location", url(project.id));
		finished.assertFlashMessage(
			"success",
			"Tattoo finished: the healing check is due 7 Nov 2026. Send the aftercare message from Message the client.",
		);
		assert.equal(await statusOf(tenant, project), "healing_check");

		const completed = await post(client, url(project.id, "/complete"), owner);
		completed.assertHeader("location", url(project.id));
		completed.assertFlashMessage(
			"success",
			"Healing check done: the project is completed.",
		);
		assert.equal(await statusOf(tenant, project), "completed");
	});

	test("money owed: the confirmation must name it, and the flash says it is still due", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, sita } = await setup();
		const project = await workDone(tenant, sita);
		await inTenant(tenant, async () => {
			// NPR 15,000 with the NPR 3,000 deposit paid: NPR 12,000 owed.
			await makeQuote(tenant, project);
			await makePayment(tenant, project, {
				status: "verified",
				verifiedAt: DateTime.utc(),
				verifiedByUserId: owner.id,
			});
		});

		const unconfirmed = await post(client, url(project.id, "/finish"), owner);
		unconfirmed.assertHeader("location", url(project.id));
		unconfirmed.assertFlashMessage(
			"error",
			"The balance changed since this page loaded. Check it and try again.",
		);
		assert.equal(await statusOf(tenant, project), "in_progress");

		const confirmed = await post(client, url(project.id, "/finish"), owner, {
			confirmedDue: "1200000",
		});
		confirmed.assertFlashMessage(
			"success",
			"Tattoo finished: the healing check is due 7 Nov 2026. Send the aftercare message from Message the client. NPR 12,000 of the balance is still due: record it under Payments when it's paid.",
		);
		assert.equal(await statusOf(tenant, project), "healing_check");
	});

	test("a stale page is refused with a flash and nothing changes", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, sita } = await setup();
		const booked = await workDone(
			tenant,
			sita,
			"booked",
			LAST_SESSION_END.minus({ days: 1 }),
		);
		const waiting = await workDone(
			tenant,
			sita,
			"in_progress",
			LAST_SESSION_END.minus({ days: 2 }),
		);
		await inTenant(tenant, async () => {
			const startsAt = DateTime.utc().plus({ days: 3 }).startOf("hour");
			await makeSession(tenant, waiting, sita, {
				kind: "consultation",
				startsAt,
				endsAt: startsAt.plus({ hours: 1 }),
			});
		});

		for (const action of ["/finish", "/complete"]) {
			(await post(client, url(booked.id, action), owner)).assertFlashMessage(
				"error",
				"This project can't make that change in its current status.",
			);
		}
		(await post(client, url(waiting.id, "/finish"), owner)).assertFlashMessage(
			"error",
			"Record or cancel the scheduled session first.",
		);
		assert.equal(await statusOf(tenant, booked), "booked");
		assert.equal(await statusOf(tenant, waiting), "in_progress");
	});

	test("a confirmation that isn't a whole paisa amount is a field error", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, sita } = await setup();
		const project = await workDone(tenant, sita);

		for (const confirmedDue of ["-5", "12.5", "abc", "1".repeat(21)]) {
			assertValidationError(
				await post(client, url(project.id, "/finish"), owner, { confirmedDue }),
				"confirmedDue",
				"Reload the page and try again.",
			);
		}
		assert.equal(await statusOf(tenant, project), "in_progress");
	});

	test("only owners: the assigned artist gets a 404 on both routes, whatever the body", async ({
		client,
		assert,
	}) => {
		const { tenant, asha, sita } = await setup();
		const working = await workDone(
			tenant,
			sita,
			"in_progress",
			LAST_SESSION_END.minus({ days: 1 }),
		);
		const healing = await workDone(
			tenant,
			sita,
			"healing_check",
			LAST_SESSION_END.minus({ days: 2 }),
		);

		for (const [project, action] of [
			[working, "/finish"],
			[healing, "/complete"],
		] as const) {
			for (const body of [{ confirmedDue: "0" }, { confirmedDue: "junk" }]) {
				(await post(client, url(project.id, action), asha, body)).assertStatus(
					404,
				);
			}
		}
		assert.equal(await statusOf(tenant, working), "in_progress");
		assert.equal(await statusOf(tenant, healing), "healing_check");
	});
});
