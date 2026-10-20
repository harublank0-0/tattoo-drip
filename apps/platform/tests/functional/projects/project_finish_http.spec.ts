import testUtils from "@adonisjs/core/services/test_utils";
import type { ApiClient } from "@japa/api-client";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import type User from "#models/user";
import type Artist from "#modules/artists/models/artist";
import { healingCheckDueOn } from "#modules/projects/finish";
import TattooProject, {
	type ProjectStatus,
} from "#modules/projects/models/tattoo_project";
import { formatDay } from "#modules/projects/quotes";
import ProjectSession from "#modules/scheduling/models/project_session";
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

const KTM = "Asia/Kathmandu";

/** What the page says the healing check's day is, for a tattoo session that ended at `endsAt`. */
const dueTextFor = (endsAt: DateTime) =>
	formatDay(
		healingCheckDueOn([{ kind: "tattoo", status: "completed", endsAt }], KTM) ??
			"",
	);

test.group("Finishing on the project page and the board (TAT-111)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("owners get the step and its action; the assigned artist sees only the healing check", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, asha, sita } = await setup();
		const now = DateTime.utc().startOf("hour");
		const working = await workDone(
			tenant,
			sita,
			"in_progress",
			now.minus({ days: 3 }),
		);
		// NPR 15,000, nothing paid.
		await inTenant(tenant, () => makeQuote(tenant, working));
		const recent = await workDone(
			tenant,
			sita,
			"healing_check",
			now.minus({ days: 1 }),
		);
		const old = await workDone(
			tenant,
			sita,
			"healing_check",
			now.minus({ days: 60 }),
		);
		await inTenant(tenant, async () => {
			const startsAt = now.plus({ days: 5 });
			await makeSession(tenant, old, sita, {
				kind: "touch_up",
				startsAt,
				endsAt: startsAt.plus({ hours: 1 }),
			});
		});
		const finishOf = async (project: TattooProject, user: User) =>
			(await client.get(url(project.id)).withInertia().loginAs(user))
				.inertiaProps.finish;

		assert.deepEqual(await finishOf(working, owner), {
			step: "finish",
			dueText: dueTextFor(now.minus({ days: 3 })),
			overdue: false,
			action: {
				confirmedDue: "1500000",
				balanceDueText: "NPR 15,000",
				estimated: false,
				sessionScheduled: false,
			},
		});
		assert.isNull(await finishOf(working, asha));
		assert.deepEqual(await finishOf(recent, asha), {
			step: "complete",
			dueText: dueTextFor(now.minus({ days: 1 })),
			overdue: false,
			action: null,
		});
		assert.deepEqual(await finishOf(old, owner), {
			step: "complete",
			dueText: dueTextFor(now.minus({ days: 60 })),
			overdue: true,
			action: {
				confirmedDue: "0",
				balanceDueText: null,
				estimated: false,
				sessionScheduled: true,
			},
		});
	});

	test("a closed project offers no step, no artist picker and no new session", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, sita } = await setup();
		const completed = await workDone(tenant, sita, "completed");
		const cancelled = await inTenant(tenant, async () =>
			makeProject(tenant, await makeClient(tenant), {
				status: "cancelled",
				artistId: sita.id,
			}),
		);
		const open = await workDone(
			tenant,
			sita,
			"in_progress",
			LAST_SESSION_END.minus({ days: 3 }),
		);
		const props = async (project: TattooProject) =>
			(await client.get(url(project.id)).withInertia().loginAs(owner))
				.inertiaProps;

		for (const project of [completed, cancelled]) {
			const page = await props(project);
			assert.isNull(page.finish, project.status);
			assert.isTrue(page.closed, project.status);
			assert.isNull(page.assignment, project.status);
			assert.isNull(page.scheduling, project.status);
		}
		const working = await props(open);
		assert.isFalse(working.closed);
		assert.isNotNull(working.assignment);
	});

	test("the healing check's Sessions card offers touch-ups only, and a tattoo session is refused", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, sita } = await setup();
		const healing = await workDone(tenant, sita, "healing_check");

		const props = (
			await client.get(url(healing.id)).withInertia().loginAs(owner)
		).inertiaProps;
		assert.deepInclude(props.scheduling, {
			kinds: ["touch_up"],
			hint: "The healing check takes touch-up sessions only.",
		});

		const date = DateTime.now()
			.setZone(KTM)
			.plus({ days: 5 })
			.toFormat("yyyy-MM-dd");
		const session = (sessionKind: string) => ({
			sessionKind,
			sessionArtistId: sita.id,
			date,
			startTime: "10:00",
			hours: "2",
		});
		(
			await post(client, url(healing.id, "/sessions"), owner, session("tattoo"))
		).assertFlashMessage(
			"error",
			"The healing check takes touch-up sessions only.",
		);
		(
			await post(
				client,
				url(healing.id, "/sessions"),
				owner,
				session("touch_up"),
			)
		).assertHeader("location", url(healing.id));

		assert.equal(await statusOf(tenant, healing), "healing_check");
		assert.deepEqual(
			await inTenant(tenant, async () =>
				(
					await ProjectSession.query()
						.where("project_id", healing.id)
						.where("status", "scheduled")
				).map(({ kind }) => kind),
			),
			["touch_up"],
		);
	});

	test("the board: a finished project that still owes is flagged for owners; artists see no flags", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, asha, sita } = await setup();
		const owing = await workDone(tenant, sita, "completed");
		await inTenant(tenant, () => makeQuote(tenant, owing));
		const healing = await workDone(
			tenant,
			sita,
			"healing_check",
			LAST_SESSION_END.minus({ days: 2 }),
		);
		type Row = { id: string; status: string; balanceOwed: boolean };
		const rows = async (status: string, user: User) =>
			(
				await client
					.get(`/t/${SLUG}/projects?status=${status}`)
					.withInertia()
					.loginAs(user)
			).inertiaProps.projects as Row[];

		assert.deepInclude(
			(await rows("closed", owner)).find(({ id }) => id === owing.id),
			{ status: "completed", balanceOwed: true },
		);
		assert.deepInclude(
			(await rows("active", owner)).find(({ id }) => id === healing.id),
			{ status: "healing_check", balanceOwed: false },
		);
		assert.deepInclude(
			(await rows("closed", asha)).find(({ id }) => id === owing.id),
			{ balanceOwed: false },
		);
	});
});
