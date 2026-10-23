import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import { PaymentRuleError } from "#modules/payments/errors";
import Payment from "#modules/payments/models/payment";
import type TattooProject from "#modules/projects/models/tattoo_project";
import { depositReady } from "#tests/helpers/deposits";
import {
	ownerMember,
	paymentServices,
	proofFor,
} from "#tests/helpers/payments";
import {
	makeArtist,
	makePayment,
	makeQuote,
	makeSession,
} from "#tests/helpers/pipeline";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";

const { payments, deposits } = paymentServices();

/** The PaymentRuleError reason `work` throws, or null if it succeeds. */
async function reasonOf(work: () => Promise<unknown>) {
	try {
		await work();
		return null;
	} catch (error) {
		if (error instanceof PaymentRuleError) return error.reason;
		throw error;
	}
}

/**
 * A studio whose deposit_pending project (deposit NPR 3,000) has its
 * client's screenshot waiting.
 */
async function waiting(
	slug: string,
	quote: Parameters<typeof depositReady>[1] = {},
) {
	const { owner, tenant } = await studioWithOwner(slug, "Black Needle");
	const { project } = await inTenant(tenant, () => depositReady(tenant, quote));
	const proof = await inTenant(tenant, () => proofFor(tenant, project));
	return { owner, tenant, member: ownerMember(owner), project, proof };
}

const fresh = <T extends Payment | TattooProject>(
	tenant: { id: string },
	model: T,
) =>
	inTenant(tenant, async () => {
		await model.refresh();
		return model;
	});

test.group("PaymentService.forProject", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("the current quote, the payments newest first, the balance and what is left of the deposit", async ({
		assert,
	}) => {
		const { tenant, project, proof } = await waiting("money-66");
		const desk = await inTenant(tenant, async () => {
			await makeQuote(tenant, project, { version: 2, depositAmount: 500_000 });
			return makePayment(tenant, project, {
				amount: 200_000,
				status: "verified",
				verifiedAt: DateTime.utc(),
			});
		});

		const money = await inTenant(tenant, () =>
			payments.forProject(tenant, project),
		);

		assert.equal(money.quote?.version, 2);
		assert.deepEqual(
			money.payments.map(({ id }) => id),
			[desk.id, proof.id],
		);
		assert.deepEqual(money.balance, {
			currency: "NPR",
			total: 1_500_000n,
			paid: 200_000n,
			due: 1_300_000n,
		});
		assert.equal(money.depositHeld, 200_000);
		assert.equal(money.depositDue, 300_000);
		assert.isNull(money.outcome);
		assert.isFalse(money.outcomeNeeded);
	});
});

test.group("PaymentService.verify and reject", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("verifying records who decided, when, and the note; a blank note is none", async ({
		assert,
	}) => {
		const one = await waiting("verify-66");
		const two = await waiting("verify-blank-66");

		await inTenant(one.tenant, () =>
			payments.verify(
				one.tenant,
				one.member,
				one.proof,
				"  On the statement  ",
			),
		);
		await inTenant(two.tenant, () =>
			payments.verify(two.tenant, two.member, two.proof, "   "),
		);

		const decided = await fresh(one.tenant, one.proof);
		assert.equal(decided.status, "verified");
		assert.equal(decided.verifiedByUserId, one.owner.id);
		assert.isBelow(
			Math.abs(decided.verifiedAt?.diffNow().as("seconds") ?? 99),
			30,
		);
		assert.equal(decided.note, "On the statement");
		assert.isNull((await fresh(two.tenant, two.proof)).note);
	});

	test("verifying a deposit books a project with a scheduled tattoo session", async ({
		assert,
	}) => {
		const { tenant, member, project, proof } = await waiting("verify-book-66");
		await inTenant(tenant, async () =>
			makeSession(tenant, project, await makeArtist(tenant)),
		);

		const result = await inTenant(tenant, () =>
			payments.verify(tenant, member, proof, null),
		);

		assert.isTrue(result.booked);
		assert.equal(result.status, "booked");
		assert.equal(result.depositDue, 0);
		assert.equal((await fresh(tenant, project)).status, "booked");
	});

	test("without a session the project waits; a partial deposit leaves the rest due", async ({
		assert,
	}) => {
		const covered = await waiting("verify-wait-66");
		const partial = await waiting("verify-part-66", { depositAmount: 500_000 });

		const done = await inTenant(covered.tenant, () =>
			payments.verify(covered.tenant, covered.member, covered.proof, null),
		);
		const part = await inTenant(partial.tenant, () =>
			payments.verify(partial.tenant, partial.member, partial.proof, null),
		);

		assert.deepEqual(
			[done.booked, done.status, done.depositDue],
			[false, "deposit_pending", 0],
		);
		assert.deepEqual(
			[part.booked, part.status, part.depositDue],
			[false, "deposit_pending", 200_000],
		);
	});

	test("rejecting keeps the proof and asks the client again, unless the quote expired", async ({
		assert,
	}) => {
		const live = await waiting("reject-66");
		const expired = await waiting("reject-late-66", {
			expiresAt: DateTime.utc().minus({ hours: 1 }),
		});
		const key = live.proof.proofImageKey;

		const asked = await inTenant(live.tenant, () =>
			payments.reject(
				live.tenant,
				live.member,
				live.proof,
				"Not on the statement",
			),
		);
		const late = await inTenant(expired.tenant, () =>
			payments.reject(expired.tenant, expired.member, expired.proof, null),
		);

		assert.isTrue(asked.asksAgain);
		assert.isFalse(late.asksAgain);
		const rejected = await fresh(live.tenant, live.proof);
		assert.deepEqual(
			[
				rejected.status,
				rejected.verifiedByUserId,
				rejected.note,
				rejected.proofImageKey,
			],
			["rejected", live.owner.id, "Not on the statement", key],
		);
		assert.equal(
			(await fresh(live.tenant, live.project)).status,
			"deposit_pending",
		);
	});

	test("a second decision is refused under the lock, and the first stands", async ({
		assert,
	}) => {
		const { tenant, member, owner, proof } = await waiting("twice-66");
		// Two tabs loaded the same waiting screenshot; the first one verifies.
		const stale = await inTenant(tenant, () => Payment.findOrFail(proof.id));
		await inTenant(tenant, () => payments.verify(tenant, member, proof, null));

		assert.equal(
			await reasonOf(() =>
				inTenant(tenant, () => payments.verify(tenant, member, stale, null)),
			),
			"already_decided",
		);
		assert.equal(
			await reasonOf(() =>
				inTenant(tenant, () => payments.reject(tenant, member, stale, "Late")),
			),
			"already_decided",
		);
		const kept = await fresh(tenant, proof);
		assert.deepEqual(
			[kept.status, kept.verifiedByUserId, kept.note],
			["verified", owner.id, null],
		);
	});

	test("a screenshot stops waiting as it is decided (what Today's badge counts)", async ({
		assert,
	}) => {
		const { tenant, member, project, proof } = await waiting("badge-66");
		const second = await inTenant(tenant, () => proofFor(tenant, project));
		const waits = () =>
			inTenant(
				tenant,
				async () =>
					(await deposits.depositStates(tenant, [project.id], new Map())).get(
						project.id,
					)?.proofWaiting,
			);

		assert.isTrue(await waits());
		await inTenant(tenant, () => payments.verify(tenant, member, proof, null));
		assert.isTrue(await waits(), "the second one still waits");
		await inTenant(tenant, () => payments.reject(tenant, member, second, null));
		assert.isFalse(await waits());
	});

	test("only owners decide, and only the studio's own payments are found", async ({
		assert,
	}) => {
		const { tenant, project, proof } = await waiting("owners-66");
		const other = await waiting("owners-other-66");
		const asha = await artistIn(tenant, "asha@owners-66.example");
		await inTenant(tenant, async () => {
			const profile = await makeArtist(tenant, "asha");
			profile.userId = asha.id;
			await profile.save();
			project.artistId = profile.id;
			await project.save();
		});
		const artist = { userId: asha.id, role: "artist" as const };

		const refused: (() => Promise<unknown>)[] = [
			() => payments.verify(tenant, artist, proof, null),
			() => payments.reject(tenant, artist, proof, null),
			() => payments.findFor(tenant, artist, proof.id),
			// Another studio's payment under this studio, and from its context.
			() => payments.findFor(tenant, ownerMember(other.owner), other.proof.id),
		];
		for (const work of refused) {
			await assert.rejects(() => inTenant(tenant, work), /Row not found/);
		}
		await assert.rejects(
			() =>
				inTenant(other.tenant, () =>
					payments.findFor(tenant, ownerMember(other.owner), proof.id),
				),
			/Row not found/,
		);
		assert.equal((await fresh(tenant, proof)).status, "submitted");
	});
});
