import { randomUUID } from "node:crypto";
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import ArtistService from "#modules/artists/services/artist_service";
import ImageService from "#modules/media/services/image_service";
import DepositService from "#modules/payments/services/deposit_service";
import TattooProject from "#modules/projects/models/tattoo_project";
import ProjectService from "#modules/projects/services/project_service";
import QuoteService from "#modules/projects/services/quote_service";
import {
	SessionOverlapError,
	SessionRuleError,
} from "#modules/scheduling/errors";
import ProjectSession, {
	type SessionKind,
} from "#modules/scheduling/models/project_session";
import SessionService, {
	type NewSession,
} from "#modules/scheduling/services/session_service";
import {
	makeArtist,
	makeClient,
	makePayment,
	makeProject,
	makeQuote,
} from "#tests/helpers/pipeline";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";

const artists = new ArtistService(new ImageService());
const quotes = new QuoteService();
const deposits = new DepositService(quotes);
const sessions = new SessionService(artists, deposits);
const projects = new ProjectService(artists, quotes, deposits, sessions);

/** An owner: the services never read the user for owners, so any id will do. */
const OWNER = { userId: randomUUID(), role: "owner" as const };

/** A session of `artist`, `days` from now at the top of an hour, two hours long. */
function slot(
	artist: { id: string },
	days: number,
	kind: SessionKind = "tattoo",
): NewSession {
	const startsAt = DateTime.now().startOf("hour").plus({ days });
	return {
		artistId: artist.id,
		kind,
		startsAt,
		endsAt: startsAt.plus({ hours: 2 }),
	};
}

const statusOf = async (project: { id: string }) =>
	(await TattooProject.findOrFail(project.id)).status;

const sessionsOf = (project: { id: string }) =>
	ProjectSession.query().where("project_id", project.id);

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
 * A studio with Sita (linked to the artist member Asha), Anu, a client,
 * and Ram, an artist member with no linked profile.
 */
async function setup() {
	const { owner, tenant } = await studioWithOwner(
		"schedule-needle-85",
		"Schedule Needle",
	);
	const ashaUser = await artistIn(tenant, "asha@schedule-needle-85.example");
	const ramUser = await artistIn(tenant, "ram@schedule-needle-85.example");
	const parts = await inTenant(tenant, async () => {
		const sita = await makeArtist(tenant, "sita");
		sita.userId = ashaUser.id;
		await sita.save();
		return {
			sita,
			anu: await makeArtist(tenant, "anu"),
			client: await makeClient(tenant),
		};
	});
	return {
		owner,
		tenant,
		...parts,
		asha: { userId: ashaUser.id, role: "artist" as const },
		ram: { userId: ramUser.id, role: "artist" as const },
	};
}

test.group("SessionService.scheduleFor and booking (TAT-85)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a tattoo session books a deposit_pending project whose deposit is zero or covered, in the same call", async ({
		assert,
	}) => {
		const { owner, tenant, client, sita } = await setup();

		await inTenant(tenant, async () => {
			const zero = await makeProject(tenant, client, {
				status: "deposit_pending",
				artistId: sita.id,
			});
			await makeQuote(tenant, zero, { depositAmount: 0 });
			const paid = await makeProject(tenant, client, {
				status: "deposit_pending",
				artistId: sita.id,
			});
			await makeQuote(tenant, paid);
			await makePayment(tenant, paid, {
				status: "verified",
				verifiedAt: DateTime.utc(),
				verifiedByUserId: owner.id,
			});

			for (const [index, project] of [zero, paid].entries()) {
				const result = await sessions.scheduleFor(
					tenant,
					OWNER,
					project,
					slot(sita, 3 + index),
				);
				assert.deepEqual(
					[result.projectStatus, result.booked, result.session.status],
					["booked", true, "scheduled"],
				);
				assert.equal(await statusOf(project), "booked");
			}
		});
	});

	test("an uncovered deposit keeps the project deposit_pending, and the deposit books it later", async ({
		assert,
	}) => {
		const { owner, tenant, client, sita } = await setup();

		await inTenant(tenant, async () => {
			const project = await makeProject(tenant, client, {
				status: "deposit_pending",
				artistId: sita.id,
			});
			await makeQuote(tenant, project);

			const result = await sessions.scheduleFor(
				tenant,
				OWNER,
				project,
				slot(sita, 3),
			);
			assert.deepEqual(
				[result.projectStatus, result.booked],
				["deposit_pending", false],
			);

			await makePayment(tenant, project, {
				status: "verified",
				verifiedAt: DateTime.utc(),
				verifiedByUserId: owner.id,
			});
			assert.isTrue(await sessions.settleBooking(tenant, project));
			assert.equal(await statusOf(project), "booked");
		});
	});

	test("before acceptance a tattoo session holds the date, and accepting a zero-deposit quote books it", async ({
		assert,
	}) => {
		const { tenant, client, sita } = await setup();

		await inTenant(tenant, async () => {
			const project = await makeProject(tenant, client, {
				status: "quoted",
				artistId: sita.id,
			});
			const quote = await makeQuote(tenant, project, { depositAmount: 0 });
			const held = await sessions.scheduleFor(
				tenant,
				OWNER,
				project,
				slot(sita, 3),
			);
			assert.deepEqual([held.projectStatus, held.booked], ["quoted", false]);
			assert.equal(
				await projects.acceptQuote(tenant, OWNER, project, quote.id),
				"booked",
			);

			// A consultation in review moves nothing.
			const reviewing = await makeProject(tenant, client, {
				status: "reviewing",
				artistId: sita.id,
			});
			const consultation = await sessions.scheduleFor(
				tenant,
				OWNER,
				reviewing,
				slot(sita, 4, "consultation"),
			);
			assert.equal(consultation.projectStatus, "reviewing");
		});
	});

	test("the next tattoo session books an in_progress project; more sessions keep a booked one booked", async ({
		assert,
	}) => {
		const { tenant, client, sita } = await setup();

		await inTenant(tenant, async () => {
			const working = await makeProject(tenant, client, {
				status: "in_progress",
				artistId: sita.id,
			});
			const next = await sessions.scheduleFor(
				tenant,
				OWNER,
				working,
				slot(sita, 3),
			);
			assert.deepEqual([next.projectStatus, next.booked], ["booked", true]);

			const booked = await makeProject(tenant, client, {
				status: "booked",
				artistId: sita.id,
			});
			for (const days of [5, 6]) {
				const more = await sessions.scheduleFor(
					tenant,
					OWNER,
					booked,
					slot(sita, days),
				);
				assert.deepEqual([more.projectStatus, more.booked], ["booked", false]);
			}
			assert.lengthOf(await sessionsOf(booked), 2);
		});
	});

	test("a finished or closed project takes no new session, and nothing is saved", async ({
		assert,
	}) => {
		const { tenant, client, sita } = await setup();

		await inTenant(tenant, async () => {
			const expected = {
				completed: "project_finished",
				healing_check: "touch_ups_only",
				declined: "project_closed",
				cancelled: "project_closed",
			} as const;
			for (const [index, [status, reason]] of Object.entries(
				expected,
			).entries()) {
				const project = await makeProject(tenant, client, {
					status: status as keyof typeof expected,
					artistId: sita.id,
				});
				assert.equal(
					await ruleOf(() =>
						sessions.scheduleFor(tenant, OWNER, project, slot(sita, 3 + index)),
					),
					reason,
					status,
				);
				assert.lengthOf(await sessionsOf(project), 0, status);
			}
		});
	});

	test("a healing check takes a touch-up session and stays in its healing check (TAT-111)", async ({
		assert,
	}) => {
		const { tenant, client, sita } = await setup();

		await inTenant(tenant, async () => {
			const healing = await makeProject(tenant, client, {
				status: "healing_check",
				artistId: sita.id,
			});
			const touchUp = await sessions.scheduleFor(
				tenant,
				OWNER,
				healing,
				slot(sita, 3, "touch_up"),
			);
			assert.deepEqual(
				[touchUp.session.kind, touchUp.projectStatus, touchUp.booked],
				["touch_up", "healing_check", false],
			);
			for (const kind of ["tattoo", "consultation"] as const) {
				assert.equal(
					await ruleOf(() =>
						sessions.scheduleFor(tenant, OWNER, healing, slot(sita, 5, kind)),
					),
					"touch_ups_only",
					kind,
				);
			}
			assert.lengthOf(await sessionsOf(healing), 1);

			const completed = await makeProject(tenant, client, {
				status: "completed",
				artistId: sita.id,
			});
			assert.equal(
				await ruleOf(() =>
					sessions.scheduleFor(
						tenant,
						OWNER,
						completed,
						slot(sita, 7, "touch_up"),
					),
				),
				"project_finished",
			);
			assert.lengthOf(await sessionsOf(completed), 0);
		});
	});
});

test.group("SessionService.scheduleFor: who and when (TAT-85)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("artists schedule only with their own profile, on a project assigned to them", async ({
		assert,
	}) => {
		const { tenant, client, sita, anu, asha, ram } = await setup();

		await inTenant(tenant, async () => {
			const mine = await makeProject(tenant, client, {
				status: "booked",
				artistId: sita.id,
			});
			const anus = await makeProject(tenant, client, {
				status: "booked",
				artistId: anu.id,
			});

			const own = await sessions.scheduleFor(tenant, asha, mine, slot(sita, 3));
			assert.equal(own.session.artistId, sita.id);
			for (const [member, project, artist] of [
				[asha, mine, anu],
				[asha, anus, sita],
				[ram, mine, sita],
			] as const) {
				await assert.rejects(
					() => sessions.scheduleFor(tenant, member, project, slot(artist, 5)),
					/Row not found/,
				);
			}
			assert.lengthOf(await sessionsOf(mine), 1);
			assert.lengthOf(await sessionsOf(anus), 0);

			// An owner reassigns the project while Asha's request waits.
			const live = await TattooProject.findOrFail(mine.id);
			live.artistId = anu.id;
			await live.save();
			await assert.rejects(
				() => sessions.scheduleFor(tenant, asha, mine, slot(sita, 7)),
				/Row not found/,
			);
			assert.lengthOf(await sessionsOf(mine), 1);
		});
	});

	test("an overlap saves nothing, not even the project's artist", async ({
		assert,
	}) => {
		const { tenant, client, sita } = await setup();

		await inTenant(tenant, async () => {
			const busy = await makeProject(tenant, client, {
				status: "booked",
				artistId: sita.id,
			});
			await sessions.scheduleFor(tenant, OWNER, busy, slot(sita, 5));

			const fresh = await makeProject(tenant, client, { status: "reviewing" });
			await assert.rejects(
				() => sessions.scheduleFor(tenant, OWNER, fresh, slot(sita, 5)),
				SessionOverlapError,
			);
			assert.isNull((await TattooProject.findOrFail(fresh.id)).artistId);
			assert.lengthOf(await sessionsOf(fresh), 0);

			await sessions.scheduleFor(
				tenant,
				OWNER,
				fresh,
				slot(sita, 6, "consultation"),
			);
			assert.equal(
				(await TattooProject.findOrFail(fresh.id)).artistId,
				sita.id,
			);
		});
	});

	test("another tenant's project refuses, and a deleted one is a 404", async ({
		assert,
	}) => {
		const { tenant, client, sita } = await setup();
		const { tenant: other } = await studioWithOwner(
			"schedule-other-85",
			"Schedule Other",
		);

		await inTenant(tenant, async () => {
			const project = await makeProject(tenant, client, {
				status: "booked",
				artistId: sita.id,
			});
			await inTenant(other, async () => {
				await assert.rejects(
					() => sessions.scheduleFor(other, OWNER, project, slot(sita, 3)),
					/belongs to another tenant/,
				);
			});
			await (await TattooProject.findOrFail(project.id)).softDelete();
			await assert.rejects(
				() => sessions.scheduleFor(tenant, OWNER, project, slot(sita, 3)),
				/Row not found/,
			);
		});
	});
});
