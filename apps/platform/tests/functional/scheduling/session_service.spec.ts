import { randomUUID } from "node:crypto";
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import ArtistService from "#modules/artists/services/artist_service";
import ImageService from "#modules/media/services/image_service";
import TattooProject, {
	PROJECT_STATUSES,
	type ProjectStatus,
} from "#modules/projects/models/tattoo_project";
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
import { dbClient } from "#services/db_context";
import { makeArtist, makeClient, makeProject } from "#tests/helpers/pipeline";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

const sessions = new SessionService(new ArtistService(new ImageService()));

/** 2 November 2026 at `hour`:`minute` UTC. */
const at = (hour: number, minute = 0) =>
	DateTime.utc(2026, 11, 2, hour, minute);

const slot = (
	artist: { id: string },
	from: number,
	to: number,
	kind: SessionKind = "tattoo",
): NewSession => ({
	artistId: artist.id,
	kind,
	startsAt: at(from),
	endsAt: at(to),
});

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

/** A studio with one project (default `booked`) and two artists. */
async function setup(status: ProjectStatus = "booked") {
	const { tenant } = await studioWithOwner();
	const parts = await inTenant(tenant, async () => {
		const client = await makeClient(tenant);
		return {
			client,
			project: await makeProject(tenant, client, { status }),
			sita: await makeArtist(tenant, "sita"),
			anu: await makeArtist(tenant, "anu"),
		};
	});
	return { tenant, ...parts };
}

test.group("SessionService schedule", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("creates a scheduled session and fills an empty project artist, never replacing one", async ({
		assert,
	}) => {
		const { tenant, project, sita, anu } = await setup();

		await inTenant(tenant, async () => {
			const session = await sessions.schedule(
				tenant,
				project,
				slot(sita, 10, 12),
			);

			assert.equal(session.tenantId, tenant.id);
			assert.equal(session.projectId, project.id);
			assert.equal(session.artistId, sita.id);
			assert.equal(session.kind, "tattoo");
			assert.equal(session.status, "scheduled");
			assert.equal(session.startsAt.toMillis(), at(10).toMillis());
			assert.equal(session.endsAt.toMillis(), at(12).toMillis());
			assert.equal(
				(await TattooProject.findOrFail(project.id)).artistId,
				sita.id,
			);

			// `project` in memory still has no artist; the live row has.
			await sessions.schedule(
				tenant,
				project,
				slot(anu, 10, 12, "consultation"),
			);
			assert.equal(
				(await TattooProject.findOrFail(project.id)).artistId,
				sita.id,
			);
		});
	});

	test("every project status takes a session except declined and cancelled", async ({
		assert,
	}) => {
		const { tenant, client, sita } = await setup();

		await inTenant(tenant, async () => {
			for (const [index, status] of PROJECT_STATUSES.entries()) {
				const project = await makeProject(tenant, client, { status });
				const attempt = () =>
					sessions.schedule(tenant, project, slot(sita, 8 + index, 9 + index));
				if (status === "declined" || status === "cancelled") {
					assert.equal(await ruleOf(attempt), "project_closed", status);
				} else {
					assert.isNull(await ruleOf(attempt), status);
				}
			}
		});
	});

	test("an invalid range is refused before the database sees it", async ({
		assert,
	}) => {
		const { tenant, project, sita } = await setup();

		await inTenant(tenant, async () => {
			const ranges: [DateTime, DateTime][] = [
				[at(10), at(10)],
				[at(12), at(10)],
				[DateTime.fromISO("not a date"), at(12)],
				[at(10), DateTime.fromISO("not a date")],
			];
			for (const [startsAt, endsAt] of ranges) {
				const rule = await ruleOf(() =>
					sessions.schedule(tenant, project, {
						artistId: sita.id,
						kind: "tattoo",
						startsAt,
						endsAt,
					}),
				);
				assert.equal(rule, "invalid_range");
			}
			assert.isEmpty(
				await ProjectSession.query().where("project_id", project.id),
			);
		});
	});

	test("a time in another zone is the same instant, and overlaps are found across zones", async ({
		assert,
	}) => {
		const { tenant, project, sita } = await setup();
		// 15:45 in Kathmandu (UTC+5:45) is 10:00 UTC.
		const local = DateTime.fromObject(
			{ year: 2026, month: 11, day: 2, hour: 15, minute: 45 },
			{ zone: "Asia/Kathmandu" },
		);

		await inTenant(tenant, async () => {
			const session = await sessions.schedule(tenant, project, {
				artistId: sita.id,
				kind: "tattoo",
				startsAt: local,
				endsAt: local.plus({ hours: 2 }),
			});

			const stored = await ProjectSession.findOrFail(session.id);
			assert.equal(stored.startsAt.toMillis(), at(10).toMillis());
			assert.equal(stored.endsAt.toMillis(), at(12).toMillis());
			await assert.rejects(
				() => sessions.schedule(tenant, project, slot(sita, 11, 13)),
				SessionOverlapError,
			);
		});
	});

	test("unknown, deleted and other-tenant ids are a 404", async ({
		assert,
	}) => {
		const { tenant, project, sita, anu } = await setup();
		const { tenant: other } = await studioWithOwner("studio-b", "Studio B");
		const theirs = await inTenant(other, () => makeArtist(other, "sita"));

		await inTenant(tenant, async () => {
			await assert.rejects(
				() => sessions.schedule(tenant, project, slot(theirs, 10, 12)),
				/Row not found/,
			);
			await assert.rejects(
				() =>
					sessions.schedule(tenant, project, {
						...slot(sita, 10, 12),
						artistId: randomUUID(),
					}),
				/Row not found/,
			);

			await sita.softDelete();
			await assert.rejects(
				() => sessions.schedule(tenant, project, slot(sita, 10, 12)),
				/Row not found/,
			);

			await project.softDelete();
			await assert.rejects(
				() => sessions.schedule(tenant, project, slot(anu, 10, 12)),
				/Row not found/,
			);
		});
	});

	test("an overlap throws SessionOverlapError, leaves the request usable and rolls back the artist fill", async ({
		assert,
	}) => {
		const { tenant, client, project, sita, anu } = await setup();

		await inTenant(tenant, async () => {
			await sessions.schedule(tenant, project, slot(sita, 10, 12));
			await assert.rejects(
				() => sessions.schedule(tenant, project, slot(sita, 11, 13)),
				SessionOverlapError,
			);
			const { rows } = await dbClient().rawQuery("select 1 as ok");
			assert.equal(rows[0].ok, 1);

			// Touching, and another artist at the same time, are fine.
			await sessions.schedule(tenant, project, slot(sita, 12, 13));
			await sessions.schedule(tenant, project, slot(anu, 10, 12));
			assert.lengthOf(
				await ProjectSession.query().where("project_id", project.id),
				3,
			);

			// A project with no artist yet: the failed schedule must not leave
			// the artist behind.
			const fresh = await makeProject(tenant, client);
			await assert.rejects(
				() => sessions.schedule(tenant, fresh, slot(sita, 11, 13)),
				SessionOverlapError,
			);
			assert.isNull((await TattooProject.findOrFail(fresh.id)).artistId);
		});
	});
});

test.group(
	"SessionService reschedule, complete, no-show and cancel",
	(group) => {
		group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

		test("reschedule changes the time, may overlap its own old time, and refuses other sessions' time", async ({
			assert,
		}) => {
			const { tenant, project, sita } = await setup();

			await inTenant(tenant, async () => {
				const session = await sessions.schedule(
					tenant,
					project,
					slot(sita, 10, 12),
				);
				await sessions.schedule(tenant, project, slot(sita, 14, 16));

				// 11:00–13:00 overlaps the session's own 10:00–12:00.
				const moved = await sessions.reschedule(tenant, session, {
					startsAt: at(11),
					endsAt: at(13),
				});
				assert.equal(moved.startsAt.toMillis(), at(11).toMillis());
				assert.equal(moved.endsAt.toMillis(), at(13).toMillis());

				await assert.rejects(
					() =>
						sessions.reschedule(tenant, session, {
							startsAt: at(15),
							endsAt: at(17),
						}),
					SessionOverlapError,
				);
				const stored = await ProjectSession.findOrFail(session.id);
				assert.equal(stored.startsAt.toMillis(), at(11).toMillis());

				assert.equal(
					await ruleOf(() =>
						sessions.reschedule(tenant, session, {
							startsAt: at(13),
							endsAt: at(13),
						}),
					),
					"invalid_range",
				);
			});
		});

		test("complete, markNoShow and cancel set the status; only a completed session keeps blocking", async ({
			assert,
		}) => {
			const { tenant, project, sita } = await setup();

			await inTenant(tenant, async () => {
				const toComplete = await sessions.schedule(
					tenant,
					project,
					slot(sita, 8, 9),
				);
				const toMiss = await sessions.schedule(
					tenant,
					project,
					slot(sita, 10, 11),
				);
				const toCancel = await sessions.schedule(
					tenant,
					project,
					slot(sita, 12, 13),
				);

				const done = await sessions.complete(tenant, toComplete);
				const missed = await sessions.markNoShow(tenant, toMiss);
				const cancelled = await sessions.cancel(tenant, toCancel);
				assert.equal(done.status, "completed");
				assert.equal(missed.status, "no_show");
				assert.equal(cancelled.status, "cancelled");

				await assert.rejects(
					() => sessions.schedule(tenant, project, slot(sita, 8, 9)),
					SessionOverlapError,
				);
				await sessions.schedule(tenant, project, slot(sita, 10, 11));
				await sessions.schedule(tenant, project, slot(sita, 12, 13));
			});
		});

		test("completed, no-show and cancelled sessions are final, even for a stale copy", async ({
			assert,
		}) => {
			const { tenant, project, sita } = await setup();

			await inTenant(tenant, async () => {
				const stale = await sessions.schedule(
					tenant,
					project,
					slot(sita, 8, 9),
				);
				const other = await sessions.schedule(
					tenant,
					project,
					slot(sita, 10, 11),
				);
				await sessions.complete(tenant, stale);
				await sessions.cancel(tenant, other);

				// `stale` still says "scheduled" in memory: the live row decides.
				for (const session of [stale, other]) {
					for (const attempt of [
						() => sessions.complete(tenant, session),
						() => sessions.markNoShow(tenant, session),
						() => sessions.cancel(tenant, session),
						() =>
							sessions.reschedule(tenant, session, {
								startsAt: at(20),
								endsAt: at(21),
							}),
					]) {
						assert.equal(await ruleOf(attempt), "not_scheduled");
					}
				}
			});
		});
	},
);

test.group("SessionService reads and tenant scoping", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("findFor and listForProject see only the tenant's live sessions, in time order", async ({
		assert,
	}) => {
		const { tenant, project, sita } = await setup();
		const { tenant: other } = await studioWithOwner("studio-b", "Studio B");

		await inTenant(tenant, async () => {
			const late = await sessions.schedule(tenant, project, slot(sita, 14, 15));
			const early = await sessions.schedule(
				tenant,
				project,
				slot(sita, 10, 11),
			);
			const deleted = await sessions.schedule(
				tenant,
				project,
				slot(sita, 16, 17),
			);
			// A fresh copy: the one the service returned belongs to its finished
			// savepoint.
			await (await ProjectSession.findOrFail(deleted.id)).softDelete();

			const listed = await sessions.listForProject(tenant, project);
			assert.deepEqual(
				listed.map(({ id }) => id),
				[early.id, late.id],
			);
			assert.equal((await sessions.findFor(tenant, early.id)).id, early.id);
			await assert.rejects(
				() => sessions.findFor(tenant, deleted.id),
				/Row not found/,
			);
			await assert.rejects(
				() => sessions.findFor(tenant, randomUUID()),
				/Row not found/,
			);

			await inTenant(other, async () => {
				await assert.rejects(
					() => sessions.findFor(other, early.id),
					/Row not found/,
				);
				await assert.rejects(
					() => sessions.listForProject(other, project),
					/belongs to another tenant/,
				);
				await assert.rejects(
					() => sessions.schedule(other, project, slot(sita, 10, 11)),
					/belongs to another tenant/,
				);
				await assert.rejects(
					() => sessions.cancel(other, early),
					/belongs to another tenant/,
				);
			});
		});
	});
});
