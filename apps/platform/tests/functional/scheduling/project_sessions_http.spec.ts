import testUtils from "@adonisjs/core/services/test_utils";
import type { ApiClient } from "@japa/api-client";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import User from "#models/user";
import type Artist from "#modules/artists/models/artist";
import TattooProject, {
	type ProjectStatus,
} from "#modules/projects/models/tattoo_project";
import ProjectSession, {
	type SessionKind,
} from "#modules/scheduling/models/project_session";
import { localDateTime, sessionTimeText } from "#modules/scheduling/times";
import TenancyService from "#modules/tenancy/services/tenancy_service";
import {
	makeArtist,
	makeClient,
	makeProject,
	makeSession,
} from "#tests/helpers/pipeline";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";
import { assertValidationError } from "#tests/helpers/validation";

const SLUG = "outcome-http-85";
const KTM = "Asia/Kathmandu";
const NY = "America/New_York";

const sessionUrl = (slug: string, id: string, action: "outcome" | "move") =>
	`/t/${slug}/sessions/${id}/${action}`;
const projectUrl = (slug: string, id: string) => `/t/${slug}/projects/${id}`;

/** Whole minutes from now. */
const fromNow = (minutes: number) =>
	DateTime.now().startOf("minute").plus({ minutes });

/** yyyy-MM-dd, `days` from today in `zone` (the test studio's, by default). */
const dayFromNow = (days: number, zone = KTM) =>
	DateTime.now().setZone(zone).plus({ days }).toFormat("yyyy-MM-dd");

/** `time` on the day `days` from today in Kathmandu. */
function localAt(days: number, time: string) {
	const instant = localDateTime(dayFromNow(days), time, KTM);
	if (!instant) throw new Error(`${time} doesn't exist in ${days} days`);
	return instant;
}

/**
 * The next day New York's clocks jump from 02:00 to 03:00 (the second
 * Sunday of March): always less than a year away, so the move form takes it.
 */
function nextSpringForward(): string {
	const today = DateTime.now().setZone(NY).startOf("day");
	for (const year of [today.year, today.year + 1]) {
		const march = DateTime.fromObject({ year, month: 3, day: 1 }, { zone: NY });
		const secondSunday = march.plus({ days: ((7 - march.weekday) % 7) + 7 });
		if (secondSunday > today) return secondSunday.toFormat("yyyy-MM-dd");
	}
	throw new Error("no spring-forward day within two years");
}

function post(
	client: ApiClient,
	url: string,
	body: Record<string, unknown>,
	user: User,
) {
	return client.post(url).form(body).withCsrfToken().loginAs(user).redirects(0);
}

/**
 * The studio: Sita (linked to the artist member Asha) and Anu, a project in
 * `status` assigned to Sita, and Ram, an artist member with no profile.
 */
async function setup(status: ProjectStatus = "booked") {
	const { owner, tenant } = await studioWithOwner(SLUG, "Outcome HTTP");
	const asha = await artistIn(tenant, "asha@outcome-http-85.example");
	const ram = await artistIn(tenant, "ram@outcome-http-85.example");
	const parts = await inTenant(tenant, async () => {
		const sita = await makeArtist(tenant, "sita");
		sita.userId = asha.id;
		await sita.save();
		const anu = await makeArtist(tenant, "anu");
		const customer = await makeClient(tenant);
		const project = await makeProject(tenant, customer, {
			status,
			artistId: sita.id,
		});
		return { sita, anu, customer, project };
	});
	return { owner, asha, ram, tenant, ...parts };
}

function sessionAt(
	tenant: { id: string },
	project: TattooProject,
	artist: Artist,
	startsAt: DateTime,
	endsAt: DateTime,
	kind: SessionKind = "tattoo",
) {
	return inTenant(tenant, () =>
		makeSession(tenant, project, artist, { kind, startsAt, endsAt }),
	);
}

const reload = (tenant: { id: string }, id: string) =>
	inTenant(tenant, () => ProjectSession.findOrFail(id));

const statusOf = (tenant: { id: string }, id: string) =>
	inTenant(tenant, async () => (await TattooProject.findOrFail(id)).status);

test.group("Session outcomes over HTTP (TAT-85)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an owner marks a started tattoo session done: back to the project, a flash, and the project is in progress", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, project, sita } = await setup();
		const session = await sessionAt(
			tenant,
			project,
			sita,
			fromNow(-120),
			fromNow(-60),
		);

		const response = await post(
			client,
			sessionUrl(SLUG, session.id, "outcome"),
			{ status: "completed" },
			owner,
		);

		response.assertHeader("location", projectUrl(SLUG, project.id));
		response.assertFlashMessage(
			"success",
			"Session marked done. The project is now in progress.",
		);
		assert.equal((await reload(tenant, session.id)).status, "completed");
		assert.equal(await statusOf(tenant, project.id), "in_progress");
	});

	test("a no-show and a cancellation free the time, each with its own flash", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, project, sita } = await setup();
		const missed = await sessionAt(
			tenant,
			project,
			sita,
			fromNow(-240),
			fromNow(-180),
		);
		const called = await sessionAt(
			tenant,
			project,
			sita,
			fromNow(1440),
			fromNow(1500),
		);

		(
			await post(
				client,
				sessionUrl(SLUG, missed.id, "outcome"),
				{ status: "no_show" },
				owner,
			)
		).assertFlashMessage(
			"success",
			"Marked as a no-show. The time is free again.",
		);
		(
			await post(
				client,
				sessionUrl(SLUG, called.id, "outcome"),
				{ status: "cancelled" },
				owner,
			)
		).assertFlashMessage(
			"success",
			"Session cancelled. The time is free again.",
		);

		assert.equal((await reload(tenant, missed.id)).status, "no_show");
		assert.equal((await reload(tenant, called.id)).status, "cancelled");
		// No tattoo session was done: the project stays booked (the board flags it).
		assert.equal(await statusOf(tenant, project.id), "booked");
	});

	test("a refused outcome is a flash and changes nothing", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, customer, project, sita } = await setup();
		const later = await sessionAt(
			tenant,
			project,
			sita,
			fromNow(1440),
			fromNow(1500),
		);

		const notYet = await post(
			client,
			sessionUrl(SLUG, later.id, "outcome"),
			{ status: "completed" },
			owner,
		);
		notYet.assertHeader("location", projectUrl(SLUG, project.id));
		notYet.assertFlashMessage(
			"error",
			"This session hasn't started yet: mark it done or a no-show once it has.",
		);
		assert.equal((await reload(tenant, later.id)).status, "scheduled");

		await post(
			client,
			sessionUrl(SLUG, later.id, "outcome"),
			{ status: "cancelled" },
			owner,
		);
		const twice = await post(
			client,
			sessionUrl(SLUG, later.id, "outcome"),
			{ status: "no_show" },
			owner,
		);
		twice.assertFlashMessage(
			"error",
			"This session already has an outcome, and outcomes can't be changed.",
		);
		assert.equal((await reload(tenant, later.id)).status, "cancelled");

		const pending = await inTenant(tenant, () =>
			makeProject(tenant, customer, {
				status: "deposit_pending",
				artistId: sita.id,
			}),
		);
		const held = await sessionAt(
			tenant,
			pending,
			sita,
			fromNow(-120),
			fromNow(-60),
		);
		const early = await post(
			client,
			sessionUrl(SLUG, held.id, "outcome"),
			{ status: "completed" },
			owner,
		);
		early.assertFlashMessage(
			"error",
			"This project isn't booked yet, so its tattoo session can't be marked done.",
		);
		assert.equal((await reload(tenant, held.id)).status, "scheduled");
	});

	test("an unknown outcome is a field error", async ({ client, assert }) => {
		const { owner, tenant, project, sita } = await setup();
		const session = await sessionAt(
			tenant,
			project,
			sita,
			fromNow(-120),
			fromNow(-60),
		);

		const response = await post(
			client,
			sessionUrl(SLUG, session.id, "outcome"),
			{ status: "scheduled" },
			owner,
		);

		assertValidationError(
			response,
			"status",
			"Choose done, no-show or cancelled.",
		);
		assert.equal((await reload(tenant, session.id)).status, "scheduled");
	});
});

test.group("Moving a session over HTTP (TAT-85)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an owner moves a session to a new local time, and the flash names it", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, project, sita } = await setup();
		const session = await sessionAt(
			tenant,
			project,
			sita,
			localAt(2, "10:00"),
			localAt(2, "12:00"),
		);
		const date = dayFromNow(3);

		const response = await post(
			client,
			sessionUrl(SLUG, session.id, "move"),
			{ date, startTime: "15:45", hours: "2.5" },
			owner,
		);

		response.assertHeader("location", projectUrl(SLUG, project.id));
		const moved = await reload(tenant, session.id);
		assert.equal(
			moved.startsAt.setZone(KTM).toFormat("yyyy-MM-dd HH:mm"),
			`${date} 15:45`,
		);
		assert.equal(moved.endsAt.diff(moved.startsAt, "minutes").minutes, 150);
		response.assertFlashMessage(
			"success",
			`Session moved: ${sessionTimeText(moved.startsAt, moved.endsAt, KTM)}.`,
		);
		assert.equal(await statusOf(tenant, project.id), "booked");
	});

	test("an overlap is a field error on the start time and nothing is saved", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, project, sita } = await setup();
		await sessionAt(
			tenant,
			project,
			sita,
			localAt(4, "10:00"),
			localAt(4, "12:00"),
		);
		const moving = await sessionAt(
			tenant,
			project,
			sita,
			localAt(5, "10:00"),
			localAt(5, "12:00"),
		);

		const response = await post(
			client,
			sessionUrl(SLUG, moving.id, "move"),
			{ date: dayFromNow(4), startTime: "11:00", hours: "2" },
			owner,
		);

		assertValidationError(
			response,
			"startTime",
			"Sita already has a session at that time. Pick another time.",
		);
		const stored = await reload(tenant, moving.id);
		assert.equal(stored.startsAt.toMillis(), moving.startsAt.toMillis());
		assert.equal(stored.endsAt.toMillis(), moving.endsAt.toMillis());
	});

	test("a past day, a missing start and a length out of quarter hours are field errors", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, project, sita } = await setup();
		const session = await sessionAt(
			tenant,
			project,
			sita,
			localAt(2, "10:00"),
			localAt(2, "12:00"),
		);
		const send = (body: Record<string, unknown>) =>
			post(client, sessionUrl(SLUG, session.id, "move"), body, owner);

		assertValidationError(
			await send({ date: dayFromNow(-1), startTime: "10:00", hours: "2" }),
			"date",
			"Pick a date from today to a year from now.",
		);
		assertValidationError(
			await send({ date: dayFromNow(3), startTime: "", hours: "2" }),
			"startTime",
			"Enter the start time, like 14:00.",
		);
		assertValidationError(
			await send({ date: dayFromNow(3), startTime: "10:00", hours: "2.1" }),
			"hours",
			"Use quarter hours: 0.25, 0.5, 0.75 and so on.",
		);
		const stored = await reload(tenant, session.id);
		assert.equal(stored.startsAt.toMillis(), session.startsAt.toMillis());
	});

	test("in a studio where the clocks change, a skipped time is a field error", async ({
		client,
		assert,
	}) => {
		const owner = await User.create({
			email: "owner@ny-needle-85.example",
			password: "secret-password",
		});
		const tenant = await new TenancyService().createTenant(owner, {
			type: "studio",
			name: "NY Needle",
			slug: "ny-needle-85",
			timezone: NY,
		});
		const { project, session } = await inTenant(tenant, async () => {
			const sita = await makeArtist(tenant);
			const project = await makeProject(tenant, await makeClient(tenant), {
				status: "booked",
				artistId: sita.id,
			});
			const startsAt = fromNow(2880);
			const session = await makeSession(tenant, project, sita, {
				startsAt,
				endsAt: startsAt.plus({ hours: 2 }),
			});
			return { project, session };
		});
		const day = nextSpringForward();

		const skipped = await post(
			client,
			sessionUrl("ny-needle-85", session.id, "move"),
			{ date: day, startTime: "02:30", hours: "1" },
			owner,
		);
		assertValidationError(
			skipped,
			"startTime",
			"That time doesn't exist on this day because the clocks change. Pick another.",
		);

		// 03:30 that day exists.
		const fine = await post(
			client,
			sessionUrl("ny-needle-85", session.id, "move"),
			{ date: day, startTime: "03:30", hours: "1" },
			owner,
		);
		fine.assertHeader("location", projectUrl("ny-needle-85", project.id));
		const moved = await reload(tenant, session.id);
		assert.equal(
			moved.startsAt.setZone(NY).toFormat("yyyy-MM-dd HH:mm"),
			`${day} 03:30`,
		);
	});
});

test.group("Who may change a session over HTTP (TAT-85)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an artist changes their own session on their project; anything else is a 404 and changes nothing", async ({
		client,
		assert,
	}) => {
		const { tenant, customer, project, sita, anu, asha, ram } = await setup();
		const mine = await sessionAt(
			tenant,
			project,
			sita,
			fromNow(-120),
			fromNow(-60),
		);
		const anus = await sessionAt(
			tenant,
			project,
			anu,
			fromNow(-120),
			fromNow(-60),
			"consultation",
		);
		const elsewhere = await inTenant(tenant, () =>
			makeProject(tenant, customer, { status: "booked", artistId: anu.id }),
		);
		const mineElsewhere = await sessionAt(
			tenant,
			elsewhere,
			sita,
			localAt(2, "10:00"),
			localAt(2, "11:00"),
			"consultation",
		);
		const move = { date: dayFromNow(6), startTime: "10:00", hours: "1" };

		for (const [user, session] of [
			[asha, anus],
			[asha, mineElsewhere],
			[ram, mine],
		] as const) {
			(
				await post(
					client,
					sessionUrl(SLUG, session.id, "outcome"),
					{ status: "cancelled" },
					user,
				)
			).assertStatus(404);
			(
				await post(client, sessionUrl(SLUG, session.id, "move"), move, user)
			).assertStatus(404);
		}
		for (const session of [mine, anus, mineElsewhere]) {
			const stored = await reload(tenant, session.id);
			assert.equal(stored.status, "scheduled");
			assert.equal(stored.startsAt.toMillis(), session.startsAt.toMillis());
		}

		const own = await post(
			client,
			sessionUrl(SLUG, mine.id, "outcome"),
			{ status: "completed" },
			asha,
		);
		own.assertHeader("location", projectUrl(SLUG, project.id));
		assert.equal((await reload(tenant, mine.id)).status, "completed");
	});
});
