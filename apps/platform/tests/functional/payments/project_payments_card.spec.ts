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

	test("the projects list flags, for owners, a screenshot to check and a deposit to settle", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner(SLUG, "Black Needle");
		const artist = await artistIn(tenant, `artist@${SLUG}.example`);
		const { waiting, closed } = await inTenant(tenant, async () => {
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
			return { waiting: pending, closed: cancelled };
		});
		const rows = async (status: string, user = owner) =>
			(
				await client
					.get(`/t/${SLUG}/projects?status=${status}`)
					.withInertia()
					.loginAs(user)
			).inertiaProps.projects;

		const active = await rows("active");
		assert.deepInclude(
			active.find(({ id }: { id: string }) => id === waiting.id),
			{ proofWaiting: true, depositToSettle: false },
		);
		const closedRows = await rows("closed");
		assert.deepInclude(
			closedRows.find(({ id }: { id: string }) => id === closed.id),
			{ proofWaiting: false, depositToSettle: true },
		);
		const artistRows = await rows("active", artist);
		assert.deepInclude(
			artistRows.find(({ id }: { id: string }) => id === waiting.id),
			{ proofWaiting: false, depositToSettle: false },
		);
	});
});
