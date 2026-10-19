import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import type Artist from "#modules/artists/models/artist";
import ArtistService from "#modules/artists/services/artist_service";
import ImageService from "#modules/media/services/image_service";
import DepositService from "#modules/payments/services/deposit_service";
import QuoteService from "#modules/projects/services/quote_service";
import ProjectSession, {
	type SessionStatus,
} from "#modules/scheduling/models/project_session";
import SessionService from "#modules/scheduling/services/session_service";
import {
	makeArtist,
	makeClient,
	makeProject,
	makeSession,
} from "#tests/helpers/pipeline";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

const sessions = new SessionService(
	new ArtistService(new ImageService()),
	new DepositService(new QuoteService()),
);

const counts = (over: Partial<Record<SessionStatus, number>> = {}) => ({
	scheduled: 0,
	completed: 0,
	no_show: 0,
	cancelled: 0,
	...over,
});

test.group("SessionService.countByStatus (TAT-85)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a window's sessions by status, for the studio and each artist, by start time", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("count-needle-85", "Count Needle");
		const { tenant: other } = await studioWithOwner(
			"count-other-85",
			"Count Other",
		);
		const from = DateTime.utc(2026, 11, 1);
		const to = DateTime.utc(2026, 12, 1);

		const { sita, anu } = await inTenant(tenant, async () => {
			const sita = await makeArtist(tenant, "sita");
			const anu = await makeArtist(tenant, "anu");
			const project = await makeProject(tenant, await makeClient(tenant), {
				status: "booked",
			});
			const on = (day: number, status: SessionStatus, artist: Artist) =>
				makeSession(tenant, project, artist, {
					status,
					startsAt: DateTime.utc(2026, 11, day, 10),
					endsAt: DateTime.utc(2026, 11, day, 11),
				});
			await on(2, "completed", sita);
			await on(3, "no_show", sita);
			await on(4, "no_show", sita);
			await on(5, "cancelled", anu);
			await on(6, "scheduled", anu);
			// Out of the window: it starts before (though it ends inside), one
			// starts at its end (half-open), and a deleted one.
			await makeSession(tenant, project, sita, {
				status: "no_show",
				startsAt: DateTime.utc(2026, 10, 31, 23),
				endsAt: DateTime.utc(2026, 11, 1, 1),
			});
			await makeSession(tenant, project, sita, {
				status: "no_show",
				startsAt: to,
				endsAt: to.plus({ hours: 1 }),
			});
			const gone = await on(7, "no_show", anu);
			await (await ProjectSession.findOrFail(gone.id)).softDelete();
			return { sita, anu };
		});

		const mine = await inTenant(tenant, () =>
			sessions.countByStatus(tenant, { from, to }),
		);
		assert.deepEqual(
			mine.studio,
			counts({ scheduled: 1, completed: 1, no_show: 2, cancelled: 1 }),
		);
		assert.deepEqual(
			mine.byArtist.get(sita.id),
			counts({ completed: 1, no_show: 2 }),
		);
		assert.deepEqual(
			mine.byArtist.get(anu.id),
			counts({ scheduled: 1, cancelled: 1 }),
		);
		assert.equal(mine.byArtist.size, 2);

		// Another studio counts none of these, even when it names this tenant:
		// its context can't see the rows.
		for (const asked of [other, tenant]) {
			const theirs = await inTenant(other, () =>
				sessions.countByStatus(asked, { from, to }),
			);
			assert.deepEqual(theirs.studio, counts());
			assert.equal(theirs.byArtist.size, 0);
		}
	});
});
