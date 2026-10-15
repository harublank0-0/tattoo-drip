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

test.group("SessionService.projectsWithScheduledTattoo", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("finds the projects with a scheduled tattoo session", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const client = await makeClient(tenant);
			const artist = await makeArtist(tenant);
			const withTattoo = await makeProject(tenant, client, {
				status: "booked",
			});
			const consultOnly = await makeProject(tenant, client, {
				status: "booked",
			});
			const cancelled = await makeProject(tenant, client, {
				status: "booked",
			});
			const none = await makeProject(tenant, client, { status: "booked" });

			await makeSession(tenant, withTattoo, artist);
			await makeSession(tenant, consultOnly, artist, {
				kind: "consultation",
				startsAt: DateTime.utc(2026, 11, 3, 10),
				endsAt: DateTime.utc(2026, 11, 3, 11),
			});
			await makeSession(tenant, cancelled, artist, {
				status: "cancelled",
				startsAt: DateTime.utc(2026, 11, 4, 10),
				endsAt: DateTime.utc(2026, 11, 4, 12),
			});

			const found = await sessions.projectsWithScheduledTattoo(tenant, [
				withTattoo.id,
				consultOnly.id,
				cancelled.id,
				none.id,
			]);
			assert.deepEqual([...found], [withTattoo.id]);
			assert.equal(
				(await sessions.projectsWithScheduledTattoo(tenant, [])).size,
				0,
			);
		});
	});

	test("another tenant's projects are never found", async ({ assert }) => {
		const { tenant: a } = await studioWithOwner("studio-a", "Studio A");
		const { tenant: b } = await studioWithOwner("studio-b", "Studio B");
		const project = await inTenant(a, async () => {
			const project = await makeProject(a, await makeClient(a), {
				status: "booked",
			});
			await makeSession(a, project, await makeArtist(a));
			return project;
		});

		const found = await inTenant(b, () =>
			sessions.projectsWithScheduledTattoo(b, [project.id]),
		);
		assert.equal(found.size, 0);
	});
});
