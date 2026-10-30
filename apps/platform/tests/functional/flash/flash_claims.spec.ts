import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import ArtistService from "#modules/artists/services/artist_service";
import ClientService from "#modules/clients/services/client_service";
import FlashDesign from "#modules/flash/models/flash_design";
import ImageService from "#modules/media/services/image_service";
import type TattooProject from "#modules/projects/models/tattoo_project";
import BookingService from "#modules/projects/services/booking_service";
import { addArtist, addFlashDesign } from "#tests/helpers/artists";
import { OWNER } from "#tests/helpers/deposits";
import {
	ownerMember,
	paymentServices,
	proofFor,
} from "#tests/helpers/payments";
import {
	makeArtist,
	makeClient,
	makeProject,
	makeQuote,
	makeSession,
} from "#tests/helpers/pipeline";
import { recordQueries } from "#tests/helpers/query_count";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

const { payments, projects, sessions, quotes } = paymentServices();

/** A studio with an artist and one one-of-a-kind design, nobody has claimed. */
async function studio(slug: string) {
	const { owner, tenant } = await studioWithOwner(slug, "Black Needle");
	const artist = await addArtist(tenant, owner);
	const design = await inTenant(tenant, () =>
		addFlashDesign(tenant, artist, { oneOfAKind: true }),
	);
	return { owner, tenant, artist, design, member: ownerMember(owner) };
}

/** A project in `status` for a new client, made from `design` (or from none), with a quote. */
const projectFor = (
	tenant: { id: string },
	design: { id: string } | null,
	status: TattooProject["status"] = "deposit_pending",
	quote: Parameters<typeof makeQuote>[2] = {},
) =>
	inTenant(tenant, async () => {
		const project = await makeProject(tenant, await makeClient(tenant), {
			status,
			flashDesignId: design?.id ?? null,
		});
		await makeQuote(tenant, project, quote);
		return project;
	});

const stored = (tenant: { id: string }, design: { id: string }) =>
	inTenant(tenant, () => FlashDesign.findOrFail(design.id));

const statusOf = (tenant: { id: string }, project: TattooProject) =>
	inTenant(tenant, async () => {
		await project.refresh();
		return project.status;
	});

const cash = (kind: "deposit" | "session" | "balance", amount = 300_000) => ({
	kind,
	method: "cash" as const,
	amount,
	note: null,
});

const EVERY_SQL = (queries: string[]) =>
	queries.filter((query) => query.includes("flash_designs"));

test.group("Claiming a one-of-a-kind design (TAT-129)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a deposit verified from a screenshot claims the design for its project", async ({
		assert,
	}) => {
		const { tenant, design, member } = await studio("claim-verify");
		const project = await projectFor(tenant, design);
		const proof = await inTenant(tenant, () => proofFor(tenant, project));
		assert.isNull((await stored(tenant, design)).claimedAt);

		await inTenant(tenant, () => payments.verify(tenant, member, proof, null));

		const claimed = await stored(tenant, design);
		assert.equal(claimed.claimedProjectId, project.id);
		assert.isNotNull(claimed.claimedAt);
		assert.isTrue(claimed.oneOfAKind);
		// A claim only marks the design: the project, its payment and its deposit stay as they were.
		assert.equal(await statusOf(tenant, project), "deposit_pending");
	});

	test("a deposit recorded at the desk claims it too", async ({ assert }) => {
		const { tenant, design, member } = await studio("claim-desk");
		const project = await projectFor(tenant, design);

		await inTenant(tenant, () =>
			payments.record(tenant, member, project, cash("deposit", 100_000)),
		);

		const claimed = await stored(tenant, design);
		assert.equal(claimed.claimedProjectId, project.id);
		assert.isNotNull(claimed.claimedAt);
	});

	test("a quote with no deposit claims it when the project is booked", async ({
		assert,
	}) => {
		const { tenant, design } = await studio("claim-booked");
		const project = await projectFor(tenant, design, "quoted", {
			depositAmount: 0,
		});
		const quote = await inTenant(tenant, async () => {
			await makeSession(tenant, project, await makeArtist(tenant, "claim-a"));
			return quotes.current(tenant, project);
		});
		assert.isNotNull(quote);
		assert.isNull((await stored(tenant, design)).claimedAt, "not before");

		const status = await inTenant(tenant, () =>
			projects.acceptQuote(
				tenant,
				OWNER,
				project,
				(quote as { id: string }).id,
			),
		);

		assert.equal(status, "booked");
		const claimed = await stored(tenant, design);
		assert.equal(claimed.claimedProjectId, project.id);
		assert.isNotNull(claimed.claimedAt);
	});

	test("scheduling the tattoo session that books a paid project changes nothing more", async ({
		assert,
	}) => {
		const { tenant, artist, design, member } = await studio("claim-schedule");
		const project = await projectFor(tenant, design);
		await inTenant(tenant, () =>
			payments.record(tenant, member, project, cash("deposit")),
		);
		const claimed = await stored(tenant, design);
		assert.equal(
			claimed.claimedProjectId,
			project.id,
			"claimed at the deposit",
		);

		const start = DateTime.utc(2026, 11, 3, 10);
		await inTenant(tenant, () =>
			sessions.schedule(tenant, project, {
				artistId: artist.id,
				kind: "tattoo",
				startsAt: start,
				endsAt: start.plus({ hours: 2 }),
			}),
		);

		assert.equal(await statusOf(tenant, project), "booked");
		const after = await stored(tenant, design);
		assert.equal(after.claimedProjectId, project.id);
		assert.equal(after.claimedAt?.toMillis(), claimed.claimedAt?.toMillis());
	});

	test("the first project keeps it: a second project's verified deposit claims nothing and both keep their statuses", async ({
		assert,
	}) => {
		const { tenant, design, member } = await studio("claim-two");
		const first = await projectFor(tenant, design);
		const second = await projectFor(tenant, design);
		const firstProof = await inTenant(tenant, () => proofFor(tenant, first));
		const secondProof = await inTenant(tenant, () => proofFor(tenant, second));

		await inTenant(tenant, () =>
			payments.verify(tenant, member, firstProof, null),
		);
		const claimed = await stored(tenant, design);
		const result = await inTenant(tenant, () =>
			payments.verify(tenant, member, secondProof, null),
		);

		assert.equal(result.payment.status, "verified", "the payment is recorded");
		const after = await stored(tenant, design);
		assert.equal(after.claimedProjectId, first.id);
		assert.equal(after.claimedAt?.toMillis(), claimed.claimedAt?.toMillis());
		assert.equal(await statusOf(tenant, first), "deposit_pending");
		assert.equal(await statusOf(tenant, second), "deposit_pending");
	});

	test("a design that can be tattooed again is never claimed; nor by a session or balance payment", async ({
		assert,
	}) => {
		const { tenant, artist, member } = await studio("claim-repeat");
		const repeatable = await inTenant(tenant, () =>
			addFlashDesign(tenant, artist),
		);
		const single = await inTenant(tenant, () =>
			addFlashDesign(tenant, artist, { oneOfAKind: true, name: "Koi" }),
		);
		const ofRepeatable = await projectFor(tenant, repeatable);
		await inTenant(tenant, () =>
			payments.record(tenant, member, ofRepeatable, cash("deposit")),
		);
		// Booked at once: no deposit, a session held.
		const ofSingle = await projectFor(tenant, single, "booked");
		await inTenant(tenant, async () => {
			await payments.record(tenant, member, ofSingle, cash("session", 50_000));
			await payments.record(tenant, member, ofSingle, cash("balance", 50_000));
		});

		assert.isNull((await stored(tenant, repeatable)).claimedAt);
		assert.isNull(
			(await stored(tenant, single)).claimedAt,
			"a session or a balance payment never claims",
		);
	});

	test("reversing or refunding the claiming deposit, and withdrawing its project, keep the claim", async ({
		assert,
	}) => {
		const { tenant, artist, design, member } = await studio("claim-keep");
		const [koi, lotus] = await inTenant(tenant, async () => [
			await addFlashDesign(tenant, artist, { oneOfAKind: true, name: "Koi" }),
			await addFlashDesign(tenant, artist, {
				oneOfAKind: true,
				name: "Lotus",
			}),
		]);

		// Reversed.
		const reversed = await projectFor(tenant, design);
		const { payment } = await inTenant(tenant, () =>
			payments.record(tenant, member, reversed, cash("deposit")),
		);
		const claim = await stored(tenant, design);
		assert.equal(claim.claimedProjectId, reversed.id);
		await inTenant(tenant, () =>
			payments.reverse(tenant, member, payment, "Typed the wrong amount"),
		);
		assert.equal(
			(await stored(tenant, design)).claimedProjectId,
			reversed.id,
			"a reversed deposit keeps the claim",
		);

		// Refunded.
		const refunded = await projectFor(tenant, koi);
		await inTenant(tenant, () =>
			payments.record(tenant, member, refunded, cash("deposit")),
		);
		await inTenant(tenant, () =>
			payments.refund(tenant, member, refunded, {
				method: "cash",
				amount: 300_000,
				note: null,
			}),
		);
		assert.equal((await stored(tenant, koi)).claimedProjectId, refunded.id);

		// Withdrawn.
		const withdrawn = await projectFor(tenant, lotus);
		await inTenant(tenant, () =>
			payments.record(tenant, member, withdrawn, cash("deposit")),
		);
		await inTenant(tenant, () =>
			projects.move(tenant, member, withdrawn, "withdraw"),
		);
		assert.equal(await statusOf(tenant, withdrawn), "cancelled");
		assert.equal((await stored(tenant, lotus)).claimedProjectId, withdrawn.id);
	});

	test("a design already claimed by hand stays claimed by hand", async ({
		assert,
	}) => {
		const { tenant, artist, member } = await studio("claim-hand");
		const byHand = await inTenant(tenant, () =>
			addFlashDesign(tenant, artist, {
				oneOfAKind: true,
				claimedAt: DateTime.now().minus({ days: 2 }),
			}),
		);
		const before = await stored(tenant, byHand);
		const project = await projectFor(tenant, byHand);

		await inTenant(tenant, () =>
			payments.record(tenant, member, project, cash("deposit")),
		);

		const after = await stored(tenant, byHand);
		assert.isNull(after.claimedProjectId);
		assert.equal(after.claimedAt?.toMillis(), before.claimedAt?.toMillis());
	});

	test("a deposit verified on a project that is already closed claims nothing", async ({
		assert,
	}) => {
		const { tenant, design, member } = await studio("claim-closed");
		const project = await projectFor(tenant, design, "cancelled");
		const proof = await inTenant(tenant, () => proofFor(tenant, project));

		await inTenant(tenant, () => payments.verify(tenant, member, proof, null));

		assert.isNull((await stored(tenant, design)).claimedAt);
	});

	test("a direct booking and a project without a design run no flash query", async ({
		assert,
	}) => {
		const { tenant, artist, member } = await studio("claim-none");
		const bookings = new BookingService(
			new ArtistService(new ImageService()),
			new ClientService(),
			quotes,
			sessions,
		);
		const startsAt = DateTime.now().plus({ days: 3 }).startOf("hour");
		const plain = await projectFor(tenant, null);
		const proof = await inTenant(tenant, () => proofFor(tenant, plain));

		const booked = await recordQueries(() =>
			inTenant(tenant, () =>
				bookings.book(tenant, member, {
					client: {
						kind: "new",
						name: "Maya Gurung",
						phone: "+9779812345679",
						email: null,
					},
					artistId: artist.id,
					brief: "A small rose",
					startsAt,
					endsAt: startsAt.plus({ hours: 3 }),
					quote: null,
				}),
			),
		);
		const verified = await recordQueries(() =>
			inTenant(tenant, () => payments.verify(tenant, member, proof, null)),
		);

		assert.equal(booked.result.project.status, "booked");
		assert.equal(verified.result.payment.status, "verified");
		assert.deepEqual(EVERY_SQL(booked.queries), []);
		assert.deepEqual(EVERY_SQL(verified.queries), []);
	});
});
