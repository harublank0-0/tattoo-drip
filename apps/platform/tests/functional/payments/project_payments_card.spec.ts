import app from "@adonisjs/core/services/app";
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import WaitingService from "#modules/projects/services/waiting_service";
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
import {
	artistIn,
	inTenant,
	inTenantAs,
	studioWithOwner,
} from "#tests/helpers/tenants";

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
		// What WaitingService says is the row's line; a money fact fills in only where it says nothing.
		const workLine = async (
			user: { id: string },
			role: "owner" | "artist",
			id: string,
		) => {
			const service = await app.container.make(WaitingService);
			const work = await inTenantAs(tenant, user, () =>
				service.work(tenant, { userId: user.id, role }, DateTime.now()),
			);
			const item = [...work.needsYou, ...work.onClient].find(
				({ project }) => project.id === id,
			);
			return item
				? {
						text: item.text,
						needsYou: item.waiting.side === "studio",
						hash: item.hash,
					}
				: null;
		};

		const active = await rows("active");
		assert.deepEqual(active.find(({ id }) => id === waiting.id)?.line, {
			text: (await workLine(owner, "owner", waiting.id))?.text,
			needsYou: true,
			hash: "payments",
		});
		// The expired quote the studio rejected a screenshot on late: the owner
		// is told, as a plain line, unless work() already has something to say.
		const lapsedLine = active.find(({ id }) => id === lapsed.id)?.line;
		assert.deepEqual(
			lapsedLine,
			(await workLine(owner, "owner", lapsed.id)) ?? {
				text: "The price has ended",
				needsYou: false,
				hash: "quote",
			},
		);
		const closedRows = await rows("closed");
		assert.deepEqual(closedRows.find(({ id }) => id === closed.id)?.line, {
			text: "Record whether the deposit was kept or refunded",
			needsYou: false,
			hash: "payments",
		});
		// The artist's row says only what work() gives them: no screenshot, no money.
		const artistRows = await rows("active", artist);
		assert.deepEqual(
			artistRows.find(({ id }) => id === waiting.id)?.line ?? null,
			await workLine(artist, "artist", waiting.id),
		);
		assert.notInclude(JSON.stringify(artistRows), "screenshot");
	});
});
