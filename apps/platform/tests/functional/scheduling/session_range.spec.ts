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

/** 2 November 2026 at `hour`:00 UTC. */
const at = (hour: number) => DateTime.utc(2026, 11, 2, hour);

const ids = (rows: { id: string }[]) => rows.map(({ id }) => id);

test.group("SessionService.listInRange", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("the active sessions that take time in the window, earliest first", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const project = await makeProject(tenant, await makeClient(tenant), {
				status: "booked",
			});
			const sita = await makeArtist(tenant, "sita");
			const anu = await makeArtist(tenant, "anu");
			const ram = await makeArtist(tenant, "ram");
			const slot = (
				artist: Artist,
				from: number,
				to: number,
				status: SessionStatus = "scheduled",
			) =>
				makeSession(tenant, project, artist, {
					startsAt: at(from),
					endsAt: at(to),
					status,
				});

			// The window is 10:00 to 14:00.
			await slot(ram, 8, 10); // ends as it opens
			await slot(ram, 14, 16); // starts as it closes
			const before = await slot(sita, 9, 11);
			const inside = await slot(sita, 11, 12, "completed");
			const after = await slot(sita, 13, 15);
			await slot(sita, 12, 13, "cancelled");
			await slot(anu, 12, 13, "no_show");
			const deleted = await slot(anu, 12, 13);
			await (await ProjectSession.findOrFail(deleted.id)).softDelete();
			const around = await slot(anu, 8, 16);

			const window = { from: at(10), to: at(14) };
			assert.deepEqual(
				ids(await sessions.listInRange(tenant, { ...window, artistId: null })),
				[around.id, before.id, inside.id, after.id],
			);
			assert.deepEqual(
				ids(
					await sessions.listInRange(tenant, { ...window, artistId: sita.id }),
				),
				[before.id, inside.id, after.id],
			);
			assert.deepEqual(
				await sessions.listInRange(tenant, { ...window, artistId: ram.id }),
				[],
			);
		});
	});

	test("only the tenant's sessions, even where row-level security shows another's", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const { tenant: other } = await studioWithOwner("studio-b", "Studio B");
		const mine = await inTenant(tenant, async () =>
			makeSession(
				tenant,
				await makeProject(tenant, await makeClient(tenant)),
				await makeArtist(tenant),
			),
		);
		const theirs = await inTenant(other, async () =>
			makeSession(
				other,
				await makeProject(other, await makeClient(other)),
				await makeArtist(other),
			),
		);
		const wholeDay = { from: at(0), to: at(23), artistId: null };

		await inTenant(tenant, async () => {
			assert.deepEqual(ids(await sessions.listInRange(tenant, wholeDay)), [
				mine.id,
			]);
		});
		await inTenant(other, async () => {
			assert.deepEqual(ids(await sessions.listInRange(other, wholeDay)), [
				theirs.id,
			]);
			// Visible to row-level security here, but asked for as black-needle.
			assert.deepEqual(await sessions.listInRange(tenant, wholeDay), []);
		});
	});
});
