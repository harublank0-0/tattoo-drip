import { randomUUID } from "node:crypto";
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import ArtistService from "#modules/artists/services/artist_service";
import ImageService from "#modules/media/services/image_service";
import DepositService from "#modules/payments/services/deposit_service";
import TattooProject, {
	type ProjectStatus,
} from "#modules/projects/models/tattoo_project";
import ProjectService from "#modules/projects/services/project_service";
import QuoteService from "#modules/projects/services/quote_service";
import SessionService from "#modules/scheduling/services/session_service";
import {
	makeArtist,
	makeClient,
	makePayment,
	makeProject,
	makeQuote,
	makeSession,
} from "#tests/helpers/pipeline";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";

const artists = new ArtistService(new ImageService());
const quotes = new QuoteService();
const deposits = new DepositService(quotes);
const sessions = new SessionService(artists, deposits);
const projects = new ProjectService(artists, quotes, deposits, sessions);

type TenantRef = { id: string };

const statusOf = async (project: TattooProject) =>
	(await TattooProject.findOrFail(project.id)).status;

/** A project in `status` whose only quote expired an hour ago. */
async function expiredQuote(
	tenant: TenantRef,
	status: ProjectStatus,
	depositAmount = 300_000,
) {
	const project = await makeProject(tenant, await makeClient(tenant), {
		status,
	});
	const quote = await makeQuote(tenant, project, {
		depositAmount,
		expiresAt: DateTime.utc().minus({ hours: 1 }),
	});
	return { project, quote };
}

test.group("ProjectService.findFor", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an owner finds any live project of the tenant", async ({ assert }) => {
		const { tenant, owner } = await studioWithOwner();
		const member = { userId: owner.id, role: "owner" as const };

		await inTenant(tenant, async () => {
			const artist = await makeArtist(tenant);
			const project = await makeProject(tenant, await makeClient(tenant), {
				artistId: artist.id,
			});

			const found = await projects.findFor(tenant, member, project.id);
			assert.equal(found.id, project.id);
			await assert.rejects(
				() => projects.findFor(tenant, member, randomUUID()),
				/Row not found/,
			);
		});
	});

	test("an artist finds only projects assigned to their own profile", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const user = await artistIn(tenant, "asha@example.com");
		const stranger = await artistIn(tenant, "ram@example.com");

		await inTenant(tenant, async () => {
			const mine = await makeArtist(tenant, "asha");
			mine.userId = user.id;
			await mine.save();
			const other = await makeArtist(tenant, "ram");
			const client = await makeClient(tenant);
			const assigned = await makeProject(tenant, client, { artistId: mine.id });
			const elsewhere = await makeProject(tenant, client, {
				artistId: other.id,
			});
			const unassigned = await makeProject(tenant, client);

			const asha = { userId: user.id, role: "artist" as const };
			assert.equal(
				(await projects.findFor(tenant, asha, assigned.id)).id,
				assigned.id,
			);
			for (const project of [elsewhere, unassigned]) {
				await assert.rejects(
					() => projects.findFor(tenant, asha, project.id),
					/Row not found/,
				);
			}

			// An artist with no profile of their own sees no project at all.
			const ram = { userId: stranger.id, role: "artist" as const };
			await assert.rejects(
				() => projects.findFor(tenant, ram, unassigned.id),
				/Row not found/,
			);
		});
	});

	test("another tenant's project is not found", async ({ assert }) => {
		const { tenant: a } = await studioWithOwner("studio-a", "Studio A");
		const { tenant: b, owner: ownerB } = await studioWithOwner(
			"studio-b",
			"Studio B",
		);
		const project = await inTenant(a, async () =>
			makeProject(a, await makeClient(a)),
		);

		await inTenant(b, async () => {
			await assert.rejects(
				() =>
					projects.findFor(b, { userId: ownerB.id, role: "owner" }, project.id),
				/Row not found/,
			);
		});
	});
});

test.group("ProjectService.expireQuote", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("cancels a quoted or on-hold project once its current quote expired", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			for (const status of ["quoted", "on_hold"] as const) {
				const { project, quote } = await expiredQuote(tenant, status);
				assert.isTrue(
					await projects.expireQuote(tenant, project.id, quote.id),
					status,
				);
				assert.equal(await statusOf(project), "cancelled", status);
			}
		});
	});

	test("cancels an accepted project whose deposit is not settled", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const { project, quote } = await expiredQuote(tenant, "deposit_pending");
			assert.isTrue(await projects.expireQuote(tenant, project.id, quote.id));
			assert.equal(await statusOf(project), "cancelled");
		});
	});

	test("spares an accepted project whose deposit is settled or zero", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const paid = await expiredQuote(tenant, "deposit_pending");
			await makePayment(tenant, paid.project, {
				status: "verified",
				verifiedAt: DateTime.utc(),
			});
			assert.isFalse(
				await projects.expireQuote(tenant, paid.project.id, paid.quote.id),
			);
			assert.equal(await statusOf(paid.project), "deposit_pending");

			const free = await expiredQuote(tenant, "deposit_pending", 0);
			assert.isFalse(
				await projects.expireQuote(tenant, free.project.id, free.quote.id),
			);
			assert.equal(await statusOf(free.project), "deposit_pending");
		});
	});

	test("leaves every other status alone", async ({ assert }) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			for (const status of [
				"reviewing",
				"booked",
				"in_progress",
				"completed",
				"healing_check",
				"declined",
				"cancelled",
			] as const) {
				const { project, quote } = await expiredQuote(tenant, status);
				assert.isFalse(
					await projects.expireQuote(tenant, project.id, quote.id),
					status,
				);
				assert.equal(await statusOf(project), status);
			}
		});
	});

	test("ignores a quote that has not expired or is no longer current", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const project = await makeProject(tenant, await makeClient(tenant), {
				status: "quoted",
			});
			const live = await makeQuote(tenant, project, {
				expiresAt: DateTime.utc().plus({ days: 1 }),
			});
			assert.isFalse(await projects.expireQuote(tenant, project.id, live.id));

			// v1's job runs after v2 replaced it; v2 has expired too, but v2's own
			// job decides that.
			const revised = await makeProject(tenant, await makeClient(tenant), {
				status: "quoted",
			});
			const v1 = await makeQuote(tenant, revised, {
				version: 1,
				expiresAt: DateTime.utc().minus({ days: 2 }),
			});
			await makeQuote(tenant, revised, {
				version: 2,
				expiresAt: DateTime.utc().minus({ hours: 1 }),
			});
			assert.isFalse(await projects.expireQuote(tenant, revised.id, v1.id));

			assert.equal(await statusOf(project), "quoted");
			assert.equal(await statusOf(revised), "quoted");
		});
	});

	test("cancels the project's scheduled sessions so the artist's time is free", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const { project, quote } = await expiredQuote(tenant, "deposit_pending");
			const artist = await makeArtist(tenant);
			const held = await makeSession(tenant, project, artist);
			const done = await makeSession(tenant, project, artist, {
				kind: "consultation",
				status: "completed",
				startsAt: DateTime.utc(2026, 10, 1, 10),
				endsAt: DateTime.utc(2026, 10, 1, 11),
			});

			assert.isTrue(await projects.expireQuote(tenant, project.id, quote.id));
			await held.refresh();
			await done.refresh();
			assert.equal(held.status, "cancelled");
			assert.equal(done.status, "completed");
		});
	});

	test("a second run, a missing project and a deleted one change nothing", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const { project, quote } = await expiredQuote(tenant, "quoted");
			assert.isTrue(await projects.expireQuote(tenant, project.id, quote.id));
			assert.isFalse(await projects.expireQuote(tenant, project.id, quote.id));

			assert.isFalse(
				await projects.expireQuote(tenant, randomUUID(), randomUUID()),
			);

			const gone = await expiredQuote(tenant, "quoted");
			await gone.project.softDelete();
			assert.isFalse(
				await projects.expireQuote(tenant, gone.project.id, gone.quote.id),
			);
		});
	});
});
