import { randomUUID } from "node:crypto";
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import type Artist from "#modules/artists/models/artist";
import ArtistService from "#modules/artists/services/artist_service";
import ImageService from "#modules/media/services/image_service";
import DepositService from "#modules/payments/services/deposit_service";
import TattooProject, {
	type ProjectStatus,
} from "#modules/projects/models/tattoo_project";
import QuoteService from "#modules/projects/services/quote_service";
import {
	SessionOverlapError,
	SessionRuleError,
} from "#modules/scheduling/errors";
import ProjectSession, {
	type SessionKind,
} from "#modules/scheduling/models/project_session";
import SessionService from "#modules/scheduling/services/session_service";
import { dbClient } from "#services/db_context";
import {
	makeArtist,
	makeClient,
	makeProject,
	makeSession,
} from "#tests/helpers/pipeline";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";

const sessions = new SessionService(
	new ArtistService(new ImageService()),
	new DepositService(new QuoteService()),
);

/** An owner: the service never reads the user for owners, so any id will do. */
const OWNER = { userId: randomUUID(), role: "owner" as const };

/** Whole minutes from now: these sessions sit around the real clock. */
const fromNow = (minutes: number) =>
	DateTime.now().startOf("minute").plus({ minutes });

/** The reason of the SessionRuleError `fn` throws, or null if it succeeds. */
async function ruleOf(fn: () => Promise<unknown>) {
	try {
		await fn();
	} catch (error) {
		if (error instanceof SessionRuleError) return error.reason;
		throw error;
	}
	return null;
}

/**
 * A studio with a project in `status` assigned to Sita, whose profile is
 * linked to the artist member Asha; a second profile, Anu; and Ram, an
 * artist member with no linked profile.
 */
async function setup(status: ProjectStatus = "booked") {
	const { tenant } = await studioWithOwner(
		"outcome-needle-85",
		"Outcome Needle",
	);
	const ashaUser = await artistIn(tenant, "asha@outcome-needle-85.example");
	const ramUser = await artistIn(tenant, "ram@outcome-needle-85.example");
	const parts = await inTenant(tenant, async () => {
		const sita = await makeArtist(tenant, "sita");
		sita.userId = ashaUser.id;
		await sita.save();
		const anu = await makeArtist(tenant, "anu");
		const client = await makeClient(tenant);
		const project = await makeProject(tenant, client, {
			status,
			artistId: sita.id,
		});
		return { sita, anu, client, project };
	});
	return {
		tenant,
		...parts,
		asha: { userId: ashaUser.id, role: "artist" as const },
		ram: { userId: ramUser.id, role: "artist" as const },
	};
}

/** A scheduled session of `artist`, from `from` to `to` minutes from now. */
function sessionAt(
	tenant: { id: string },
	project: TattooProject,
	artist: Artist,
	from: number,
	to: number,
	kind: SessionKind = "tattoo",
) {
	return makeSession(tenant, project, artist, {
		kind,
		startsAt: fromNow(from),
		endsAt: fromNow(to),
	});
}

test.group("SessionService.recordOutcome (TAT-85)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an owner records each outcome; only a completed session keeps blocking its time", async ({
		assert,
	}) => {
		const { tenant, project, sita } = await setup();

		await inTenant(tenant, async () => {
			const toComplete = await sessionAt(
				tenant,
				project,
				sita,
				-300,
				-240,
				"consultation",
			);
			const toMiss = await sessionAt(
				tenant,
				project,
				sita,
				-180,
				-120,
				"consultation",
			);
			const toCancel = await sessionAt(
				tenant,
				project,
				sita,
				60,
				120,
				"consultation",
			);

			const done = await sessions.recordOutcome(
				tenant,
				OWNER,
				toComplete,
				"completed",
			);
			const missed = await sessions.recordOutcome(
				tenant,
				OWNER,
				toMiss,
				"no_show",
			);
			const cancelled = await sessions.recordOutcome(
				tenant,
				OWNER,
				toCancel,
				"cancelled",
			);

			assert.deepEqual(
				[done, missed, cancelled].map(({ session }) => [
					session.status,
					session.active,
				]),
				[
					["completed", true],
					["no_show", false],
					["cancelled", false],
				],
			);
			// Consultations never move the project.
			assert.deepEqual(
				[done.projectStatus, done.projectMoved],
				["booked", false],
			);
		});
	});

	test("done and no-show wait for the start; cancelling doesn't", async ({
		assert,
	}) => {
		const { tenant, project, sita } = await setup();

		await inTenant(tenant, async () => {
			const later = await sessionAt(
				tenant,
				project,
				sita,
				120,
				180,
				"consultation",
			);
			assert.equal(
				await ruleOf(() =>
					sessions.recordOutcome(tenant, OWNER, later, "completed"),
				),
				"not_started",
			);
			assert.equal(
				await ruleOf(() =>
					sessions.recordOutcome(tenant, OWNER, later, "no_show"),
				),
				"not_started",
			);
			assert.equal(
				(await ProjectSession.findOrFail(later.id)).status,
				"scheduled",
			);

			// At its start time it has started.
			const atStart = await sessions.recordOutcome(
				tenant,
				OWNER,
				later,
				"no_show",
				later.startsAt,
			);
			assert.equal(atStart.session.status, "no_show");

			const another = await sessionAt(
				tenant,
				project,
				sita,
				240,
				300,
				"consultation",
			);
			assert.equal(
				(await sessions.recordOutcome(tenant, OWNER, another, "cancelled"))
					.session.status,
				"cancelled",
			);
		});
	});

	test("tattoo work is marked done only once the project is booked; other kinds any time", async ({
		assert,
	}) => {
		const { tenant, client, sita } = await setup();

		await inTenant(tenant, async () => {
			const early = [
				"reviewing",
				"quoted",
				"on_hold",
				"deposit_pending",
			] as const;
			for (const [index, status] of early.entries()) {
				const project = await makeProject(tenant, client, {
					status,
					artistId: sita.id,
				});
				const start = -60 * (index + 2);
				const tattoo = await sessionAt(
					tenant,
					project,
					sita,
					start,
					start + 30,
				);
				assert.equal(
					await ruleOf(() =>
						sessions.recordOutcome(tenant, OWNER, tattoo, "completed"),
					),
					"not_booked",
					status,
				);
				assert.equal(
					(await ProjectSession.findOrFail(tattoo.id)).status,
					"scheduled",
					status,
				);
				// A no-show is still recorded, and the project stays where it was.
				const missed = await sessions.recordOutcome(
					tenant,
					OWNER,
					tattoo,
					"no_show",
				);
				assert.deepEqual(
					[missed.session.status, missed.projectStatus],
					["no_show", status],
				);
				const consultation = await sessionAt(
					tenant,
					project,
					sita,
					start + 30,
					start + 45,
					"consultation",
				);
				assert.equal(
					(
						await sessions.recordOutcome(
							tenant,
							OWNER,
							consultation,
							"completed",
						)
					).session.status,
					"completed",
					status,
				);
			}

			const later = ["in_progress", "completed", "healing_check"] as const;
			for (const [index, status] of later.entries()) {
				const project = await makeProject(tenant, client, {
					status,
					artistId: sita.id,
				});
				const start = -600 - 60 * index;
				const tattoo = await sessionAt(
					tenant,
					project,
					sita,
					start,
					start + 30,
				);
				const done = await sessions.recordOutcome(
					tenant,
					OWNER,
					tattoo,
					"completed",
				);
				assert.deepEqual(
					[done.session.status, done.projectStatus, done.projectMoved],
					["completed", status, false],
					status,
				);
			}
		});
	});

	test("a booked project's first finished tattoo session starts the work, and the result says so", async ({
		assert,
	}) => {
		const { tenant, project, sita } = await setup("booked");

		await inTenant(tenant, async () => {
			const tattoo = await sessionAt(tenant, project, sita, -120, -60);
			const done = await sessions.recordOutcome(
				tenant,
				OWNER,
				tattoo,
				"completed",
			);
			assert.deepEqual(
				[done.projectStatus, done.projectMoved],
				["in_progress", true],
			);
			assert.equal(
				(await TattooProject.findOrFail(project.id)).status,
				"in_progress",
			);
		});
	});

	test("an outcome is final: a second tap or a stale copy is refused and changes nothing", async ({
		assert,
	}) => {
		const { tenant, project, sita } = await setup();

		await inTenant(tenant, async () => {
			const session = await sessionAt(
				tenant,
				project,
				sita,
				-60,
				-30,
				"consultation",
			);
			await sessions.recordOutcome(tenant, OWNER, session, "completed");

			// `session` still says "scheduled" in memory: the locked row decides.
			for (const outcome of ["completed", "no_show", "cancelled"] as const) {
				assert.equal(
					await ruleOf(() =>
						sessions.recordOutcome(tenant, OWNER, session, outcome),
					),
					"not_scheduled",
					outcome,
				);
			}
			assert.equal(
				await ruleOf(() =>
					sessions.move(tenant, OWNER, session, {
						startsAt: fromNow(600),
						endsAt: fromNow(660),
					}),
				),
				"not_scheduled",
			);
			const stored = await ProjectSession.findOrFail(session.id);
			assert.equal(stored.status, "completed");
			assert.equal(stored.startsAt.toMillis(), session.startsAt.toMillis());
		});
	});
});

test.group("SessionService: who may change a session (TAT-85)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("owners change any session; an artist only their own, on a project assigned to them", async ({
		assert,
	}) => {
		const { tenant, client, project, sita, anu, asha, ram } = await setup();

		await inTenant(tenant, async () => {
			const mine = await sessionAt(
				tenant,
				project,
				sita,
				-60,
				-30,
				"consultation",
			);
			const anusHere = await sessionAt(
				tenant,
				project,
				anu,
				-60,
				-30,
				"consultation",
			);
			const elsewhere = await makeProject(tenant, client, {
				status: "booked",
				artistId: anu.id,
			});
			const mineElsewhere = await sessionAt(
				tenant,
				elsewhere,
				sita,
				60,
				90,
				"consultation",
			);
			const later = { startsAt: fromNow(600), endsAt: fromNow(660) };

			assert.equal(
				(await sessions.findChangeable(tenant, asha, mine.id)).id,
				mine.id,
			);
			for (const session of [anusHere, mineElsewhere]) {
				await assert.rejects(
					() => sessions.findChangeable(tenant, asha, session.id),
					/Row not found/,
				);
				await assert.rejects(
					() => sessions.recordOutcome(tenant, asha, session, "cancelled"),
					/Row not found/,
				);
				await assert.rejects(
					() => sessions.move(tenant, asha, session, later),
					/Row not found/,
				);
			}
			for (const session of [mine, anusHere, mineElsewhere]) {
				await assert.rejects(
					() => sessions.findChangeable(tenant, ram, session.id),
					/Row not found/,
				);
				await assert.rejects(
					() => sessions.recordOutcome(tenant, ram, session, "cancelled"),
					/Row not found/,
				);
				assert.equal(
					(await sessions.findChangeable(tenant, OWNER, session.id)).id,
					session.id,
				);
			}
			for (const session of [mine, anusHere, mineElsewhere]) {
				const stored = await ProjectSession.findOrFail(session.id);
				assert.equal(stored.status, "scheduled");
				assert.equal(stored.startsAt.toMillis(), session.startsAt.toMillis());
			}

			assert.equal(
				(await sessions.recordOutcome(tenant, asha, mine, "completed")).session
					.status,
				"completed",
			);
			assert.equal(
				(await sessions.recordOutcome(tenant, OWNER, anusHere, "no_show"))
					.session.status,
				"no_show",
			);
			const moved = await sessions.move(tenant, OWNER, mineElsewhere, later);
			assert.equal(moved.startsAt.toMillis(), later.startsAt.toMillis());
		});
	});

	test("a project reassigned while the artist's request waited is a 404 under the lock", async ({
		assert,
	}) => {
		const { tenant, project, sita, anu, asha } = await setup();

		await inTenant(tenant, async () => {
			const session = await sessionAt(
				tenant,
				project,
				sita,
				-60,
				-30,
				"consultation",
			);
			const found = await sessions.findChangeable(tenant, asha, session.id);

			// An owner reassigns the project between the read and the write.
			const live = await TattooProject.findOrFail(project.id);
			live.artistId = anu.id;
			await live.save();

			await assert.rejects(
				() => sessions.recordOutcome(tenant, asha, found, "completed"),
				/Row not found/,
			);
			await assert.rejects(
				() =>
					sessions.move(tenant, asha, found, {
						startsAt: fromNow(600),
						endsAt: fromNow(660),
					}),
				/Row not found/,
			);
			assert.equal(
				(await ProjectSession.findOrFail(session.id)).status,
				"scheduled",
			);
		});
	});

	test("unknown, deleted and other tenants' sessions, and those of a deleted project, are a 404", async ({
		assert,
	}) => {
		const { tenant, project, sita } = await setup();
		const { tenant: other } = await studioWithOwner(
			"outcome-other-85",
			"Outcome Other",
		);

		await inTenant(tenant, async () => {
			const session = await sessionAt(
				tenant,
				project,
				sita,
				-60,
				-30,
				"consultation",
			);
			const gone = await sessionAt(
				tenant,
				project,
				sita,
				60,
				90,
				"consultation",
			);
			await (await ProjectSession.findOrFail(gone.id)).softDelete();
			for (const id of [randomUUID(), gone.id]) {
				await assert.rejects(
					() => sessions.findChangeable(tenant, OWNER, id),
					/Row not found/,
				);
			}

			await inTenant(other, async () => {
				await assert.rejects(
					() => sessions.findChangeable(other, OWNER, session.id),
					/Row not found/,
				);
				await assert.rejects(
					() => sessions.recordOutcome(other, OWNER, session, "cancelled"),
					/belongs to another tenant/,
				);
				await assert.rejects(
					() =>
						sessions.move(other, OWNER, session, {
							startsAt: fromNow(600),
							endsAt: fromNow(660),
						}),
					/belongs to another tenant/,
				);
			});

			await (await TattooProject.findOrFail(project.id)).softDelete();
			await assert.rejects(
				() => sessions.findChangeable(tenant, OWNER, session.id),
				/Row not found/,
			);
			await assert.rejects(
				() => sessions.recordOutcome(tenant, OWNER, session, "cancelled"),
				/Row not found/,
			);
		});
	});
});

test.group("SessionService.move (TAT-85)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a member moves a scheduled session, even one whose time has passed; the project's status stays", async ({
		assert,
	}) => {
		const { tenant, project, sita, asha } = await setup();

		await inTenant(tenant, async () => {
			const past = await sessionAt(tenant, project, sita, -120, -60);
			const to = {
				startsAt: past.startsAt.plus({ days: 2 }),
				endsAt: past.endsAt.plus({ days: 2, minutes: 30 }),
			};
			const moved = await sessions.move(tenant, asha, past, to);
			assert.equal(moved.startsAt.toMillis(), to.startsAt.toMillis());
			assert.equal(moved.endsAt.toMillis(), to.endsAt.toMillis());
			assert.deepEqual([moved.status, moved.active], ["scheduled", true]);
			assert.equal(
				(await TattooProject.findOrFail(project.id)).status,
				"booked",
			);
		});
	});

	test("an overlap with the artist's other session saves nothing and leaves the request usable", async ({
		assert,
	}) => {
		const { tenant, project, sita, anu } = await setup();

		await inTenant(tenant, async () => {
			const first = await sessionAt(tenant, project, sita, 600, 660);
			const second = await sessionAt(tenant, project, sita, 720, 780);
			await assert.rejects(
				() =>
					sessions.move(tenant, OWNER, first, {
						startsAt: second.startsAt.minus({ minutes: 30 }),
						endsAt: second.endsAt,
					}),
				SessionOverlapError,
			);
			const stored = await ProjectSession.findOrFail(first.id);
			assert.equal(stored.startsAt.toMillis(), first.startsAt.toMillis());
			const { rows } = await dbClient().rawQuery("select 1 as ok");
			assert.equal(rows[0].ok, 1);

			// Its own old time, and another artist's time, are free to it.
			await sessions.move(tenant, OWNER, first, {
				startsAt: first.startsAt.plus({ minutes: 30 }),
				endsAt: first.endsAt.plus({ minutes: 30 }),
			});
			const anus = await sessionAt(tenant, project, anu, 900, 960);
			const onAnus = await sessions.move(tenant, OWNER, first, {
				startsAt: anus.startsAt,
				endsAt: anus.endsAt,
			});
			assert.equal(onAnus.startsAt.toMillis(), anus.startsAt.toMillis());
		});
	});
});
