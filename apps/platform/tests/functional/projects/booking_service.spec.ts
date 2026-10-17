import { randomUUID } from "node:crypto";
import testUtils from "@adonisjs/core/services/test_utils";
import queue from "@adonisjs/queue/services/main";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import Artist from "#modules/artists/models/artist";
import ArtistService from "#modules/artists/services/artist_service";
import { ClientRuleError } from "#modules/clients/errors";
import Client from "#modules/clients/models/client";
import ClientService from "#modules/clients/services/client_service";
import ImageService from "#modules/media/services/image_service";
import DepositService from "#modules/payments/services/deposit_service";
import { BookingRuleError } from "#modules/projects/errors";
import ExpireQuoteJob from "#modules/projects/jobs/expire_quote_job";
import Quote from "#modules/projects/models/quote";
import TattooProject from "#modules/projects/models/tattoo_project";
import { expiresAtFor } from "#modules/projects/quotes";
import BookingService, {
	type DirectBooking,
} from "#modules/projects/services/booking_service";
import QuoteService from "#modules/projects/services/quote_service";
import { SessionOverlapError } from "#modules/scheduling/errors";
import SessionService from "#modules/scheduling/services/session_service";
import {
	makeArtist,
	makeClient,
	makeProject,
	makeSession,
	nextPhone,
	pipelineCounts,
} from "#tests/helpers/pipeline";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";

const artists = new ArtistService(new ImageService());
const quotes = new QuoteService();
const sessions = new SessionService(artists, new DepositService(quotes));
const bookings = new BookingService(
	artists,
	new ClientService(),
	quotes,
	sessions,
);

const KTM = "Asia/Kathmandu";

/** An owner: the service never reads the user for owners, so any id will do. */
const OWNER = { userId: randomUUID(), role: "owner" as const };

/** 14:00 in Kathmandu, three days from now. */
const threeDaysOut = () =>
	DateTime.now()
		.setZone(KTM)
		.plus({ days: 3 })
		.set({ hour: 14, minute: 0, second: 0, millisecond: 0 });

/** A three-hour booking of a new client, Maya, with no price. */
function booking(
	artistId: string,
	over: Partial<DirectBooking> = {},
): DirectBooking {
	const startsAt = threeDaysOut();
	return {
		client: {
			kind: "new",
			name: "Maya Gurung",
			phone: "+9779812345678",
			email: null,
		},
		artistId,
		brief: "A small rose on the left wrist",
		startsAt,
		endsAt: startsAt.plus({ hours: 3 }),
		quote: null,
		...over,
	};
}

/** The error `work` throws; fails the test if it succeeds. */
async function refusal(work: () => Promise<unknown>): Promise<unknown> {
	try {
		await work();
	} catch (error) {
		return error;
	}
	throw new Error("expected the booking to be refused");
}

test.group("BookingService.book", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.teardown(() => queue.restore());

	test("books a new client: client, booked project, fixed quote and tattoo session, and no expiry job", async ({
		assert,
	}) => {
		const fake = queue.fake();
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const sita = await makeArtist(tenant);
			const input = booking(sita.id, {
				client: {
					kind: "new",
					name: "Maya Gurung",
					phone: "+9779812345678",
					email: "maya@example.com",
				},
				quote: { kind: "fixed", fixedPrice: 1_500_000 },
			});

			const { project, session, client, artist } = await bookings.book(
				tenant,
				OWNER,
				input,
			);

			assert.equal(artist.id, sita.id);
			assert.include((await Client.findOrFail(client.id)).serialize(), {
				name: "Maya Gurung",
				phone: "+9779812345678",
				email: "maya@example.com",
				notes: null,
			});
			const saved = await TattooProject.findOrFail(project.id);
			assert.include(saved.serialize(), {
				clientId: client.id,
				artistId: sita.id,
				inquiryId: null,
				status: "booked",
				brief: "A small rose on the left wrist",
			});
			assert.isNotNull(saved.lastContactedAt);
			assert.include(session.serialize(), {
				projectId: project.id,
				artistId: sita.id,
				kind: "tattoo",
				status: "scheduled",
			});
			assert.equal(session.startsAt.toMillis(), input.startsAt.toMillis());
			assert.equal(session.endsAt.toMillis(), input.endsAt.toMillis());

			const all = await Quote.query().where("project_id", project.id);
			assert.lengthOf(all, 1);
			assert.include(all[0].serialize(), {
				version: 1,
				kind: "fixed",
				fixedPrice: 1_500_000,
				hourlyRate: null,
				estimatedMinutes: null,
				depositAmount: 0,
				currency: "NPR",
			});
			// Valid through the session's day in the studio's timezone.
			assert.equal(
				all[0].expiresAt.toMillis(),
				expiresAtFor(input.startsAt.toFormat("yyyy-MM-dd"), KTM).toMillis(),
			);
		});
		fake.assertNotPushed(ExpireQuoteJob);
	});

	test("a returning client is used as they are; an hourly quote, then no quote", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const sita = await makeArtist(tenant);
			const maya = await makeClient(tenant, {
				name: "Maya Gurung",
				email: "old@example.com",
				notes: "Allergic to latex",
			});
			const before = (await Client.findOrFail(maya.id)).serialize();

			const first = await bookings.book(
				tenant,
				OWNER,
				booking(sita.id, {
					client: { kind: "existing", id: maya.id },
					quote: {
						kind: "hourly",
						hourlyRate: 300_000,
						estimatedMinutes: 270,
					},
				}),
			);
			assert.equal(first.project.clientId, maya.id);
			assert.equal(first.client.id, maya.id);
			assert.deepEqual((await Client.findOrFail(maya.id)).serialize(), before);
			const [hourly] = await Quote.query().where(
				"project_id",
				first.project.id,
			);
			assert.include(hourly.serialize(), {
				kind: "hourly",
				hourlyRate: 300_000,
				estimatedMinutes: 270,
				fixedPrice: null,
				depositAmount: 0,
			});

			const nextDay = threeDaysOut().plus({ days: 1 });
			const second = await bookings.book(
				tenant,
				OWNER,
				booking(sita.id, {
					client: { kind: "existing", id: maya.id },
					startsAt: nextDay,
					endsAt: nextDay.plus({ hours: 1 }),
				}),
			);
			assert.lengthOf(
				await Quote.query().where("project_id", second.project.id),
				0,
			);
		});
	});

	test("an overlap saves nothing at all, not even the new client, and the transaction goes on", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const sita = await makeArtist(tenant);
			const busy = await makeProject(tenant, await makeClient(tenant), {
				status: "booked",
				artistId: sita.id,
			});
			const input = booking(sita.id, {
				quote: { kind: "fixed", fixedPrice: 500_000 },
			});
			// Starts an hour into the new booking.
			await makeSession(tenant, busy, sita, {
				startsAt: input.startsAt.plus({ hours: 1 }),
				endsAt: input.endsAt.plus({ hours: 1 }),
			});
			const before = await pipelineCounts(tenant);

			assert.instanceOf(
				await refusal(() => bookings.book(tenant, OWNER, input)),
				SessionOverlapError,
			);
			// These queries run, so only the booking's savepoint was rolled back.
			assert.deepEqual(await pipelineCounts(tenant), before);
			assert.isNull(
				await Client.query().where("phone", "+9779812345678").first(),
			);
		});
	});

	test("owners book any live artist; an artist only their own profile", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const { tenant: other } = await studioWithOwner("studio-b", "Studio B");
		const asha = await artistIn(tenant, "asha@example.com");
		const ram = await artistIn(tenant, "ram@example.com");
		const elsewhere = await inTenant(other, () => makeArtist(other));

		await inTenant(tenant, async () => {
			const own = await Artist.create({
				tenantId: tenant.id,
				name: "Asha",
				slug: "asha",
				userId: asha.id,
			});
			const sita = await makeArtist(tenant);
			const gone = await Artist.create({
				tenantId: tenant.id,
				name: "Gone",
				slug: "gone",
			});
			await gone.softDelete();
			const ashaMember = { userId: asha.id, role: "artist" as const };
			// An artist member with no profile linked to them.
			const ramMember = { userId: ram.id, role: "artist" as const };

			assert.deepEqual(
				(await bookings.bookableArtists(tenant, OWNER)).map(({ name }) => name),
				["Asha", "Sita"],
			);
			assert.deepEqual(
				(await bookings.bookableArtists(tenant, ashaMember)).map(
					({ id }) => id,
				),
				[own.id],
			);
			assert.deepEqual(await bookings.bookableArtists(tenant, ramMember), []);

			const booked = await bookings.book(tenant, ashaMember, booking(own.id));
			assert.equal(booked.project.artistId, own.id);

			const before = await pipelineCounts(tenant);
			for (const [member, artistId] of [
				[ashaMember, sita.id],
				[ramMember, sita.id],
				[OWNER, gone.id],
				[OWNER, elsewhere.id],
			] as const) {
				const error = await refusal(() =>
					bookings.book(
						tenant,
						member,
						booking(artistId, {
							client: {
								kind: "new",
								name: "Someone",
								phone: nextPhone(),
								email: null,
							},
						}),
					),
				);
				assert.instanceOf(error, BookingRuleError);
				assert.equal((error as BookingRuleError).reason, "artist_unavailable");
			}
			assert.deepEqual(await pipelineCounts(tenant), before);
		});
	});

	test("another studio's client is not found; an anonymized client and a number taken meanwhile are refused", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const { tenant: other } = await studioWithOwner("studio-b", "Studio B");
		const theirs = await inTenant(other, () => makeClient(other));

		await inTenant(tenant, async () => {
			const sita = await makeArtist(tenant);
			const anonymous = await makeClient(tenant, {
				phone: null,
				anonymizedAt: DateTime.now(),
			});
			await makeClient(tenant, { name: "Ram Thapa", phone: "+9779812345678" });
			const before = await pipelineCounts(tenant);

			await assert.rejects(
				() =>
					bookings.book(
						tenant,
						OWNER,
						booking(sita.id, { client: { kind: "existing", id: theirs.id } }),
					),
				/Row not found/,
			);
			const anonymized = await refusal(() =>
				bookings.book(
					tenant,
					OWNER,
					booking(sita.id, { client: { kind: "existing", id: anonymous.id } }),
				),
			);
			assert.instanceOf(anonymized, BookingRuleError);
			assert.equal(
				(anonymized as BookingRuleError).reason,
				"client_unavailable",
			);
			// booking() adds Maya with Ram's number.
			const taken = await refusal(() =>
				bookings.book(tenant, OWNER, booking(sita.id)),
			);
			assert.instanceOf(taken, ClientRuleError);
			assert.equal((taken as ClientRuleError).reason, "phone_taken");

			assert.deepEqual(await pipelineCounts(tenant), before);
		});
	});
});
