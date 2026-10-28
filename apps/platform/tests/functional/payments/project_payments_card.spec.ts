import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import { depositReady } from "#tests/helpers/deposits";
import {
	ownerMember,
	paymentServices,
	proofFor,
} from "#tests/helpers/payments";
import {
	makeArtist,
	makeClient,
	makePayment,
	makeProject,
	makeQuote,
} from "#tests/helpers/pipeline";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";

const SLUG = "pay-card-66";
type Line = { text: string; needsYou: boolean; hash: string | null };
const page = (id: string) => `/t/${SLUG}/projects/${id}`;
const { links } = paymentServices();

test.group("The Payments card on the project page", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an owner sees the screenshot with its signed URL, the amount asked and the reference code", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner(SLUG, "Black Needle");
		const { project } = await inTenant(tenant, () => depositReady(tenant));
		const { link } = await inTenant(tenant, () =>
			links.issue(tenant, ownerMember(owner), project),
		);
		const proof = await inTenant(tenant, () => proofFor(tenant, project));

		const props = (
			await client.get(page(project.id)).withInertia().loginAs(owner)
		).inertiaProps;

		const [pending] = props.payments.pending;
		assert.equal(pending.paymentId, proof.id);
		assert.equal(pending.expectedText, "NPR 3,000");
		assert.equal(pending.referenceCode, link.referenceCode);
		assert.include(pending.imageUrl, `/files/${proof.proofImageKey}?`);
		assert.include(pending.imageUrl, "signature=");
		assert.deepEqual(props.payments.actions.recordKinds, [
			"deposit",
			"session",
			"balance",
		]);
	});

	test("the assigned artist's card has the list and balance, no screenshots and no actions", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner(SLUG, "Black Needle");
		const asha = await artistIn(tenant, `asha@${SLUG}.example`);
		const project = await inTenant(tenant, async () => {
			const profile = await makeArtist(tenant, "asha");
			profile.userId = asha.id;
			await profile.save();
			const { project: made } = await depositReady(tenant);
			made.artistId = profile.id;
			await made.save();
			await proofFor(tenant, made);
			await proofFor(tenant, made, {
				status: "verified",
				verifiedAt: DateTime.utc(),
			});
			return made;
		});

		const response = await client
			.get(page(project.id))
			.withInertia()
			.loginAs(asha);

		response.assertStatus(200);
		const card = response.inertiaProps.payments;
		assert.lengthOf(card.rows, 2);
		assert.deepEqual(card.pending, []);
		assert.isNull(card.actions);
		assert.isNull(card.outcome.needed);
		assert.notInclude(JSON.stringify(card), "signature=");
		assert.equal(card.balance.state, "due");
	});

	test("the assigned artist gets no URL or key of a decided screenshot; the owner does (TAT-16)", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner(SLUG, "Black Needle");
		const asha = await artistIn(tenant, `asha@${SLUG}.example`);
		const { project, shots } = await inTenant(tenant, async () => {
			const profile = await makeArtist(tenant, "asha");
			profile.userId = asha.id;
			await profile.save();
			const { project: made } = await depositReady(tenant);
			made.artistId = profile.id;
			await made.save();
			const verified = await proofFor(tenant, made, {
				status: "verified",
				verifiedAt: DateTime.utc(),
				verifiedByUserId: owner.id,
			});
			const rejected = await proofFor(tenant, made, {
				status: "rejected",
				verifiedAt: DateTime.utc(),
				verifiedByUserId: owner.id,
			});
			return { project: made, shots: [verified, rejected] };
		});

		const mine = (
			await client.get(page(project.id)).withInertia().loginAs(asha)
		).inertiaProps;
		const theirs = (
			await client.get(page(project.id)).withInertia().loginAs(owner)
		).inertiaProps;

		assert.lengthOf(mine.payments.rows, 2);
		for (const row of mine.payments.rows) assert.isNull(row.proofUrl);
		const text = JSON.stringify(mine);
		assert.notInclude(text, "signature=");
		for (const shot of shots) {
			assert.notInclude(text, shot.proofImageKey as string);
		}
		// The control: the owner's page has each decided screenshot's signed URL.
		for (const shot of shots) {
			const row = theirs.payments.rows.find(
				({ id }: { id: string }) => id === shot.id,
			);
			assert.include(row.proofUrl, `/files/${shot.proofImageKey}?`);
			assert.include(row.proofUrl, "signature=");
		}
	});

	test("the projects list flags, for owners, a screenshot to check, a deposit to settle and an expired quote", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner(SLUG, "Black Needle");
		const artist = await artistIn(tenant, `artist@${SLUG}.example`);
		const { waiting, closed, lapsed } = await inTenant(tenant, async () => {
			const { project: pending } = await depositReady(tenant);
			await proofFor(tenant, pending);
			// The artist is assigned to it, so their list has the row too.
			const profile = await makeArtist(tenant, "asha");
			profile.userId = artist.id;
			await profile.save();
			pending.artistId = profile.id;
			await pending.save();
			const cancelled = await makeProject(tenant, await makeClient(tenant), {
				status: "cancelled",
			});
			await makeQuote(tenant, cancelled);
			await makePayment(tenant, cancelled, {
				status: "verified",
				verifiedAt: DateTime.utc(),
			});
			// An expired quote the studio rejected a screenshot on late: spared.
			const lapsed = await makeProject(tenant, await makeClient(tenant), {
				status: "deposit_pending",
			});
			await makeQuote(tenant, lapsed, {
				expiresAt: DateTime.utc().minus({ hours: 1 }),
			});
			await makePayment(tenant, lapsed, {
				status: "rejected",
				verifiedAt: DateTime.utc(),
			});
			return { waiting: pending, closed: cancelled, lapsed };
		});
		const rows = async (status: string, user = owner) =>
			(
				await client
					.get(`/t/${SLUG}/projects?status=${status}`)
					.withInertia()
					.loginAs(user)
			).inertiaProps.projects as { id: string; line: Line | null }[];
		const active = await rows("active");
		// A waiting screenshot is work()'s, never a money line: the studio's, first.
		assert.deepEqual(active.find(({ id }) => id === waiting.id)?.line, {
			text: "Deposit screenshot to check",
			needsYou: true,
			hash: "payments",
		});
		// An expired quote the studio rejected a screenshot on late is spared by the sweep, so
		// work() has the project: an unpaid deposit and no link yet (the studio's to do).
		assert.deepEqual(active.find(({ id }) => id === lapsed.id)?.line, {
			text: "No deposit link yet",
			needsYou: true,
			hash: "deposit",
		});
		// A closed project is out of work(): the owner's money line, plain.
		const closedRows = await rows("closed");
		assert.deepEqual(closedRows.find(({ id }) => id === closed.id)?.line, {
			text: "Record whether the deposit was kept or refunded",
			needsYou: false,
			hash: "payments",
		});
		// The artist's row is the project they were given: an unpaid deposit on the client's
		// side, with no screenshot and no money.
		const artistRows = await rows("active", artist);
		assert.deepEqual(artistRows.find(({ id }) => id === waiting.id)?.line, {
			text: "Waiting for the deposit",
			needsYou: false,
			hash: null,
		});
		assert.notInclude(JSON.stringify(artistRows), "screenshot");
	});
});
