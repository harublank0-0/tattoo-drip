import testUtils from "@adonisjs/core/services/test_utils";
import type { Assert } from "@japa/assert";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import ProjectSession, {
	SESSION_KINDS,
	SESSION_STATUSES,
} from "#modules/scheduling/models/project_session";
import { withDbContext, withTransaction } from "#services/db_context";
import {
	makeArtist,
	makeClient,
	makeProject,
	makeSession,
} from "#tests/helpers/pipeline";
import { assertRowLevelSecurity } from "#tests/helpers/rls";
import { idOf, insertRow, updateRow } from "#tests/helpers/sql";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

/** 2 November 2026 at `hour`:`minute` UTC. */
const at = (hour: number, minute = 0) =>
	new Date(Date.UTC(2026, 10, 2, hour, minute));

const OVERLAP = /project_sessions_artist_no_overlap/;

let seeded = 0;

const newSession = (
	tenantId: string,
	projectId: string,
	artistId: string,
	from: Date,
	to: Date,
	over: Record<string, unknown> = {},
) => ({
	tenant_id: tenantId,
	project_id: projectId,
	artist_id: artistId,
	kind: "tattoo",
	starts_at: from,
	ends_at: to,
	...over,
});

/** A project and two artists in `tenant`. */
const parentsIn = (tenant: { id: string }) =>
	inTenant(tenant, async () => {
		const client = await makeClient(tenant);
		const project = await makeProject(tenant, client);
		const sita = await makeArtist(tenant, "sita");
		const anu = await makeArtist(tenant, "anu");
		return { project, sita, anu };
	});

/** The insert fails; it runs in a savepoint so the test can go on. */
const rejects = (
	assert: Assert,
	row: Record<string, unknown>,
	message: RegExp,
) =>
	assert.rejects(
		() => withTransaction((inner) => insertRow(inner, "project_sessions", row)),
		message,
	);

test.group("project_sessions table", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an artist cannot have two blocking sessions that overlap; touching ones are fine", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const { project, sita } = await parentsIn(tenant);
		const row = (from: Date, to: Date) =>
			newSession(tenant.id, project.id, sita.id, from, to);

		await withDbContext({ tenantId: tenant.id }, async (trx) => {
			await insertRow(trx, "project_sessions", row(at(10), at(12)));
			const overlapping: [Date, Date][] = [
				[at(11), at(13)], // starts inside
				[at(9), at(11)], // ends inside
				[at(10, 30), at(11, 30)], // inside
				[at(9), at(13)], // contains it
				[at(10), at(12)], // identical
			];
			for (const [from, to] of overlapping) {
				await rejects(assert, row(from, to), OVERLAP);
			}
			// Half-open ranges: starting when another ends, or ending when it
			// starts, is not an overlap.
			await insertRow(trx, "project_sessions", row(at(12), at(13)));
			await insertRow(trx, "project_sessions", row(at(8), at(10)));
		});
	});

	test("only scheduled and completed sessions block; cancelled, no-show and deleted ones do not", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const { project, sita } = await parentsIn(tenant);
		const row = (from: Date, to: Date, over: Record<string, unknown> = {}) =>
			newSession(tenant.id, project.id, sita.id, from, to, over);

		await withDbContext({ tenantId: tenant.id }, async (trx) => {
			const base = idOf(
				await insertRow(trx, "project_sessions", row(at(10), at(12))),
			);
			for (const status of ["cancelled", "no_show"]) {
				await insertRow(
					trx,
					"project_sessions",
					row(at(10), at(12), { status }),
				);
			}

			// A completed session still blocks the time it occupied.
			await insertRow(
				trx,
				"project_sessions",
				row(at(14), at(16), { status: "completed" }),
			);
			await rejects(assert, row(at(15), at(17)), OVERLAP);

			// Putting a cancelled session back into a taken slot is refused.
			const cancelled = idOf(
				await insertRow(
					trx,
					"project_sessions",
					row(at(11), at(13), { status: "cancelled" }),
				),
			);
			await assert.rejects(
				() =>
					withTransaction((inner) =>
						updateRow(inner, "project_sessions", cancelled, {
							status: "scheduled",
						}),
					),
				OVERLAP,
			);

			// A soft-deleted session frees its time; restoring it needs the time free.
			await updateRow(trx, "project_sessions", base, {
				deleted_at: new Date(),
			});
			await insertRow(trx, "project_sessions", row(at(10), at(12)));
			await assert.rejects(
				() =>
					withTransaction((inner) =>
						updateRow(inner, "project_sessions", base, { deleted_at: null }),
					),
				OVERLAP,
			);
		});
	});

	test("two artists may have sessions at the same time", async () => {
		const { tenant } = await studioWithOwner();
		const { project, sita, anu } = await parentsIn(tenant);

		await withDbContext({ tenantId: tenant.id }, async (trx) => {
			for (const artist of [sita, anu]) {
				await insertRow(
					trx,
					"project_sessions",
					newSession(tenant.id, project.id, artist.id, at(10), at(12)),
				);
			}
		});
	});

	test("a session must end after it starts", async ({ assert }) => {
		const { tenant } = await studioWithOwner();
		const { project, sita } = await parentsIn(tenant);

		await withDbContext({ tenantId: tenant.id }, async () => {
			const ranges: [Date, Date][] = [
				[at(10), at(10)],
				[at(12), at(10)],
			];
			for (const [from, to] of ranges) {
				await rejects(
					assert,
					newSession(tenant.id, project.id, sita.id, from, to),
					/project_sessions_ends_after_starts/,
				);
			}
		});
	});

	test("active is generated from status and deleted_at and cannot be written", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const { project, sita } = await parentsIn(tenant);
		const row = (hour: number, over: Record<string, unknown> = {}) =>
			newSession(tenant.id, project.id, sita.id, at(hour), at(hour + 1), over);

		await withDbContext({ tenantId: tenant.id }, async (trx) => {
			const activeOf = async (id: string) =>
				(
					await trx.rawQuery(
						"select active from project_sessions where id = ?",
						[id],
					)
				).rows[0].active;

			const scheduled = idOf(await insertRow(trx, "project_sessions", row(8)));
			const completed = idOf(
				await insertRow(
					trx,
					"project_sessions",
					row(9, { status: "completed" }),
				),
			);
			const noShow = idOf(
				await insertRow(
					trx,
					"project_sessions",
					row(10, { status: "no_show" }),
				),
			);
			const cancelled = idOf(
				await insertRow(
					trx,
					"project_sessions",
					row(11, { status: "cancelled" }),
				),
			);
			assert.isTrue(await activeOf(scheduled));
			assert.isTrue(await activeOf(completed));
			assert.isFalse(await activeOf(noShow));
			assert.isFalse(await activeOf(cancelled));

			await updateRow(trx, "project_sessions", scheduled, {
				deleted_at: new Date(),
			});
			assert.isFalse(await activeOf(scheduled));

			await rejects(assert, row(12, { active: true }), /column "active"/);
			await assert.rejects(
				() =>
					withTransaction((inner) =>
						updateRow(inner, "project_sessions", completed, { active: false }),
					),
				/column "active"/,
			);
		});
	});

	test("kind and status only take their listed values", async ({ assert }) => {
		const { tenant } = await studioWithOwner();
		const { project, sita } = await parentsIn(tenant);

		await withDbContext({ tenantId: tenant.id }, async () => {
			await rejects(
				assert,
				newSession(tenant.id, project.id, sita.id, at(10), at(12), {
					kind: "piercing",
				}),
				/project_sessions_kind_check/,
			);
			await rejects(
				assert,
				newSession(tenant.id, project.id, sita.id, at(10), at(12), {
					status: "pending",
				}),
				/project_sessions_status_check/,
			);
		});
	});

	test("a session links only to its own tenant's project and artist", async ({
		assert,
	}) => {
		const { tenant: a } = await studioWithOwner("studio-a", "Studio A");
		const { tenant: b } = await studioWithOwner("studio-b", "Studio B");
		const mine = await parentsIn(a);
		const theirs = await parentsIn(b);

		await withDbContext({ tenantId: a.id }, async (trx) => {
			await rejects(
				assert,
				newSession(a.id, theirs.project.id, mine.sita.id, at(10), at(12)),
				/project_sessions_tenant_id_project_id_foreign/,
			);
			await rejects(
				assert,
				newSession(a.id, mine.project.id, theirs.sita.id, at(10), at(12)),
				/project_sessions_tenant_id_artist_id_foreign/,
			);
			await insertRow(
				trx,
				"project_sessions",
				newSession(a.id, mine.project.id, mine.sita.id, at(10), at(12)),
			);
		});
	});

	test("a project or artist with a session cannot be hard-deleted", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const { project, sita } = await parentsIn(tenant);

		await withDbContext({ tenantId: tenant.id }, async (trx) => {
			await insertRow(
				trx,
				"project_sessions",
				newSession(tenant.id, project.id, sita.id, at(10), at(12)),
			);
			for (const [table, id, constraint] of [
				[
					"tattoo_projects",
					project.id,
					/project_sessions_tenant_id_project_id_foreign/,
				],
				["artists", sita.id, /project_sessions_tenant_id_artist_id_foreign/],
			] as const) {
				await assert.rejects(
					() =>
						withTransaction((inner) =>
							inner.rawQuery(`delete from ${table} where id = ?`, [id]),
						),
					constraint,
				);
			}
		});
	});

	test("row-level security", async ({ assert }) => {
		await assertRowLevelSecurity(assert, "project_sessions", async (tenant) => {
			seeded += 1;
			const { project, sita } = await inTenant(tenant, async () => {
				const client = await makeClient(tenant);
				return {
					project: await makeProject(tenant, client),
					// A fresh slug each call: slugs are unique per tenant.
					sita: await makeArtist(tenant, `artist-${seeded}`),
				};
			});
			return newSession(tenant.id, project.id, sita.id, at(10), at(12));
		});
	});
});

test.group("ProjectSession model", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("keeps its columns and lists its allowed values", async ({ assert }) => {
		const { tenant } = await studioWithOwner();
		const { project, sita } = await parentsIn(tenant);

		await inTenant(tenant, async () => {
			const session = await makeSession(tenant, project, sita);
			// Lucid leaves columns the database fills in undefined until reloaded.
			await session.refresh();
			assert.equal(session.tenantId, tenant.id);
			assert.equal(session.projectId, project.id);
			assert.equal(session.artistId, sita.id);
			assert.equal(session.kind, "tattoo");
			assert.equal(session.status, "scheduled");
			assert.equal(
				session.startsAt.toMillis(),
				DateTime.utc(2026, 11, 2, 10).toMillis(),
			);
			assert.equal(
				session.endsAt.toMillis(),
				DateTime.utc(2026, 11, 2, 12).toMillis(),
			);
			assert.isTrue(session.active);
			assert.isNull(session.deletedAt);
		});
		assert.deepEqual(
			[...SESSION_KINDS],
			["consultation", "tattoo", "touch_up"],
		);
		assert.deepEqual(
			[...SESSION_STATUSES],
			["scheduled", "completed", "no_show", "cancelled"],
		);
	});

	test("a soft delete frees the artist's time and a restore needs it free", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const { project, sita } = await parentsIn(tenant);

		await inTenant(tenant, async () => {
			const first = await makeSession(tenant, project, sita);
			await first.softDelete();

			assert.isNull(await ProjectSession.find(first.id));
			const trashed = await ProjectSession.withTrashed()
				.where("id", first.id)
				.firstOrFail();
			assert.isFalse(trashed.active);

			// The same time is free again.
			await makeSession(tenant, project, sita);
			await assert.rejects(
				() => withTransaction((trx) => first.restore(trx)),
				OVERLAP,
			);
		});
	});
});
