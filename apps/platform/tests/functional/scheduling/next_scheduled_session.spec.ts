import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import ArtistService from "#modules/artists/services/artist_service";
import ImageService from "#modules/media/services/image_service";
import DepositService from "#modules/payments/services/deposit_service";
import QuoteService from "#modules/projects/services/quote_service";
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

/** `hours` after `now`, one hour long unless `lasts` says otherwise. */
function at(now: DateTime, hours: number, lasts = 1) {
	return {
		startsAt: now.plus({ hours }),
		endsAt: now.plus({ hours: hours + lasts }),
	};
}

test.group("SessionService.nextScheduled (TAT-110)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("the earliest scheduled session that hasn't ended, of any kind", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const now = DateTime.utc().startOf("hour");

		await inTenant(tenant, async () => {
			const client = await makeClient(tenant);
			const project = await makeProject(tenant, client, { status: "booked" });
			const sita = await makeArtist(tenant, "sita");
			const aarav = await makeArtist(tenant, "aarav");

			await makeSession(tenant, project, sita, {
				status: "completed",
				...at(now, -24),
			});
			await makeSession(tenant, project, sita, {
				status: "cancelled",
				...at(now, 24),
			});
			await makeSession(tenant, project, sita, {
				status: "no_show",
				...at(now, 48),
			});
			const deleted = await makeSession(tenant, project, sita, {
				...at(now, 30),
			});
			await deleted.softDelete();
			const consultation = await makeSession(tenant, project, sita, {
				kind: "consultation",
				...at(now, 72),
			});
			await makeSession(tenant, project, aarav, {
				kind: "tattoo",
				...at(now, 240, 3),
			});

			const next = await sessions.nextScheduled(tenant, project, now);

			assert.equal(next?.id, consultation.id);
			assert.equal(next?.artistId, sita.id);
		});
	});

	test("one under way still counts; one that ended without an outcome doesn't", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const now = DateTime.utc().startOf("hour");

		await inTenant(tenant, async () => {
			const client = await makeClient(tenant);
			const underWay = await makeProject(tenant, client, { status: "booked" });
			const stale = await makeProject(tenant, client, { status: "booked" });
			const sita = await makeArtist(tenant);

			const current = await makeSession(tenant, underWay, sita, {
				...at(now, -1, 2),
			});
			await makeSession(tenant, stale, sita, { ...at(now, -3, 2) });

			assert.equal(
				(await sessions.nextScheduled(tenant, underWay, now))?.id,
				current.id,
			);
			assert.isNull(await sessions.nextScheduled(tenant, stale, now));
		});
	});

	test("only this project's, only this tenant's", async ({ assert }) => {
		const { tenant } = await studioWithOwner();
		const { tenant: other } = await studioWithOwner("next-b-110", "Next B");
		const now = DateTime.utc().startOf("hour");

		const none = await inTenant(tenant, async () => {
			const client = await makeClient(tenant);
			const none = await makeProject(tenant, client, { status: "booked" });
			const busy = await makeProject(tenant, client, { status: "booked" });
			const sita = await makeArtist(tenant);
			await makeSession(tenant, busy, sita, { ...at(now, 24) });
			return none;
		});
		await inTenant(other, async () => {
			const client = await makeClient(other);
			const project = await makeProject(other, client, { status: "booked" });
			const artist = await makeArtist(other);
			await makeSession(other, project, artist, { ...at(now, 24) });
		});

		await inTenant(tenant, async () => {
			assert.isNull(await sessions.nextScheduled(tenant, none, now));
		});
	});

	test("refuses another tenant's project", async ({ assert }) => {
		const { tenant } = await studioWithOwner();
		const { tenant: other } = await studioWithOwner("next-b-110", "Next B");

		const project = await inTenant(tenant, async () => {
			const client = await makeClient(tenant);
			return makeProject(tenant, client, { status: "booked" });
		});

		await inTenant(other, async () => {
			await assert.rejects(
				() => sessions.nextScheduled(other, project),
				/belongs to another tenant/,
			);
		});
	});
});
