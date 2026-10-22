import app from "@adonisjs/core/services/app";
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import ProjectService from "#modules/projects/services/project_service";
import SessionService from "#modules/scheduling/services/session_service";
import {
	makeArtist,
	makeClient,
	makeProject,
	makeSession,
} from "#tests/helpers/pipeline";
import { recordQueries } from "#tests/helpers/query_count";
import {
	artistIn,
	inTenant,
	inTenantAs,
	studioWithOwner,
} from "#tests/helpers/tenants";

let projects: ProjectService;
let sessions: SessionService;

/** Two hours from `days` days ahead at 10:00 UTC, on top of the hour so two sessions never overlap. */
const slot = (days: number, hours = 10) => {
	const startsAt = DateTime.utc().startOf("day").plus({ days, hours });
	return { startsAt, endsAt: startsAt.plus({ hours: 2 }) };
};

test.group("ProjectService.listKeys (TAT-109)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.setup(async () => {
		projects = await app.container.make(ProjectService);
	});

	test("gives every open project the member may see, oldest first, with its sort keys", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const member = { userId: owner.id, role: "owner" as const };
		await inTenant(tenant, async () => {
			const customer = await makeClient(tenant);
			const contacted = DateTime.utc().minus({ days: 3 });
			const older = await makeProject(tenant, customer, {
				status: "quoted",
				lastContactedAt: contacted,
				createdAt: DateTime.utc().minus({ days: 9 }),
			});
			const newer = await makeProject(tenant, customer, {
				status: "reviewing",
				createdAt: DateTime.utc().minus({ days: 2 }),
			});
			await makeProject(tenant, customer, { status: "cancelled" });
			await makeProject(tenant, customer, { status: "completed" });

			const keys = await projects.listKeys(tenant, member, "active");
			assert.deepEqual(
				keys.map(({ id }) => id),
				[older.id, newer.id],
			);
			assert.equal(keys[0].status, "quoted");
			assert.equal(keys[0].lastContactedAt?.toMillis(), contacted.toMillis());
			assert.isNull(keys[1].lastContactedAt);
			assert.equal(keys[1].createdAt.toMillis(), newer.createdAt.toMillis());

			const quoted = await projects.listKeys(tenant, member, "quoted");
			assert.deepEqual(
				quoted.map(({ id }) => id),
				[older.id],
			);
		});
	});

	test("an artist gets only their own projects, an unlinked artist none", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const asha = await artistIn(tenant, "asha@example.com");
		const stranger = await artistIn(tenant, "stranger@example.com");
		await inTenant(tenant, async () => {
			const profile = await makeArtist(tenant, "asha");
			profile.userId = asha.id;
			await profile.save();
			const customer = await makeClient(tenant);
			const mine = await makeProject(tenant, customer, {
				artistId: profile.id,
			});
			await makeProject(tenant, customer);

			const own = await projects.listKeys(
				tenant,
				{ userId: asha.id, role: "artist" },
				"active",
			);
			assert.deepEqual(
				own.map(({ id }) => id),
				[mine.id],
			);
			const none = await projects.listKeys(
				tenant,
				{ userId: stranger.id, role: "artist" },
				"active",
			);
			assert.deepEqual(none, []);
		});
	});

	test("another studio's context sees nothing", async ({ assert }) => {
		const a = await studioWithOwner("studio-a-keys", "Studio A");
		const b = await studioWithOwner("studio-b-keys", "Studio B");
		await inTenant(a.tenant, async () => {
			await makeProject(a.tenant, await makeClient(a.tenant));
		});
		// The limit of the tenant filter: RLS would hide the row too, so check
		// both ways, from B's context asking for A's tenant.
		const seen = await inTenantAs(b.tenant, b.owner, () =>
			projects.listKeys(
				a.tenant,
				{ userId: b.owner.id, role: "owner" },
				"active",
			),
		);
		assert.deepEqual(seen, []);
		const own = await inTenantAs(a.tenant, a.owner, () =>
			projects.listKeys(
				a.tenant,
				{ userId: a.owner.id, role: "owner" },
				"active",
			),
		);
		assert.lengthOf(own, 1);
	});
});

test.group("SessionService.nextScheduledFor (TAT-109)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.setup(async () => {
		sessions = await app.container.make(SessionService);
	});

	test("gives each project its first scheduled session that has not ended, in one query", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const seeded = await inTenant(tenant, async () => {
			const artist = await makeArtist(tenant, "asha");
			const customer = await makeClient(tenant);
			const one = await makeProject(tenant, customer, { status: "booked" });
			const two = await makeProject(tenant, customer, { status: "booked" });
			const three = await makeProject(tenant, customer, { status: "booked" });
			const four = await makeProject(tenant, customer, { status: "booked" });
			const none = await makeProject(tenant, customer, { status: "booked" });

			await makeSession(tenant, one, artist, slot(10));
			const soonest = await makeSession(tenant, one, artist, slot(3));
			// Ended yesterday (still "scheduled" until someone records it): skipped.
			await makeSession(tenant, two, artist, slot(-1));
			const upcoming = await makeSession(tenant, two, artist, slot(5));
			for (const [day, status] of [
				[20, "cancelled"],
				[21, "completed"],
				[22, "no_show"],
			] as const) {
				await makeSession(tenant, three, artist, { ...slot(day), status });
			}
			// A touch-up counts as the next session.
			const touchUp = await makeSession(tenant, four, artist, {
				...slot(7),
				kind: "touch_up",
			});
			return { one, two, three, four, none, soonest, upcoming, touchUp };
		});
		const { one, two, three, four, none } = seeded;

		// recordQueries wraps the tenant context: it cannot run inside one.
		const { result, queries } = await recordQueries(() =>
			inTenant(tenant, () =>
				sessions.nextScheduledFor(tenant, [one.id, two.id, three.id, none.id]),
			),
		);
		assert.equal(result.get(one.id)?.id, seeded.soonest.id);
		assert.equal(result.get(two.id)?.id, seeded.upcoming.id);
		assert.isFalse(result.has(three.id));
		assert.isFalse(result.has(none.id));
		assert.lengthOf(
			queries.filter((sql) => sql.includes('from "project_sessions"')),
			1,
		);

		const withTouchUp = await inTenant(tenant, () =>
			sessions.nextScheduledFor(tenant, [four.id]),
		);
		assert.equal(withTouchUp.get(four.id)?.id, seeded.touchUp.id);
	});

	test("an empty list runs no query", async ({ assert }) => {
		const { tenant } = await studioWithOwner();
		const { result, queries } = await recordQueries(() =>
			sessions.nextScheduledFor(tenant, []),
		);
		assert.equal(result.size, 0);
		assert.lengthOf(queries, 0);
	});

	test("another studio's context sees nothing", async ({ assert }) => {
		const a = await studioWithOwner("studio-a-next", "Studio A");
		const b = await studioWithOwner("studio-b-next", "Studio B");
		const project = await inTenant(a.tenant, async () => {
			const artist = await makeArtist(a.tenant, "asha");
			const made = await makeProject(a.tenant, await makeClient(a.tenant), {
				status: "booked",
			});
			await makeSession(a.tenant, made, artist, slot(4));
			return made;
		});
		const seen = await inTenantAs(b.tenant, b.owner, () =>
			sessions.nextScheduledFor(a.tenant, [project.id]),
		);
		assert.equal(seen.size, 0);
		const own = await inTenantAs(a.tenant, a.owner, () =>
			sessions.nextScheduledFor(a.tenant, [project.id]),
		);
		assert.equal(own.size, 1);
	});
});
