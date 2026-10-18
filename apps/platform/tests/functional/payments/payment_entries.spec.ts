import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import { PaymentRuleError } from "#modules/payments/errors";
import Payment from "#modules/payments/models/payment";
import type TattooProject from "#modules/projects/models/tattoo_project";
import { PROJECT_STATUSES } from "#modules/projects/models/tattoo_project";
import { ownerMember, paymentServices } from "#tests/helpers/payments";
import {
	makeArtist,
	makeClient,
	makePayment,
	makeProject,
	makeQuote,
	makeSession,
} from "#tests/helpers/pipeline";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";

const { payments } = paymentServices();

async function reasonOf(work: () => Promise<unknown>) {
	try {
		await work();
		return null;
	} catch (error) {
		if (error instanceof PaymentRuleError) return error.reason;
		throw error;
	}
}

/** A studio, its owner as a member, and a project in `status` with the default quote. */
async function setUp(slug: string, status: TattooProject["status"]) {
	const { owner, tenant } = await studioWithOwner(slug, "Black Needle");
	const project = await inTenant(tenant, async () => {
		const made = await makeProject(tenant, await makeClient(tenant), {
			status,
		});
		await makeQuote(tenant, made);
		return made;
	});
	return { owner, tenant, member: ownerMember(owner), project };
}

/** A verified NPR 3,000 deposit on `project`. */
const paid = (tenant: { id: string }, project: TattooProject) =>
	inTenant(tenant, () =>
		makePayment(tenant, project, {
			status: "verified",
			verifiedAt: DateTime.utc(),
		}),
	);

const cash = (kind: "deposit" | "session" | "balance", amount = 300_000) => ({
	kind,
	method: "cash" as const,
	amount,
	note: null,
});

test.group("PaymentService.record", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a desk payment is verified at once by the owner, in the quote's currency, with its note", async ({
		assert,
	}) => {
		const { owner, tenant, member, project } = await setUp("desk-66", "booked");

		const { payment } = await inTenant(tenant, () =>
			payments.record(tenant, member, project, {
				kind: "balance",
				method: "fonepay",
				amount: 1_200_050,
				note: " Rest of the price ",
			}),
		);

		assert.deepEqual(
			[
				payment.kind,
				payment.amount,
				payment.currency,
				payment.method,
				payment.status,
				payment.verifiedByUserId,
				payment.note,
				payment.proofImageKey,
			],
			[
				"balance",
				1_200_050,
				"NPR",
				"fonepay",
				"verified",
				owner.id,
				"Rest of the price",
				null,
			],
		);
		assert.isNotNull(payment.verifiedAt);
	});

	test("a desk deposit books a deposit_pending project with a scheduled tattoo session", async ({
		assert,
	}) => {
		const { tenant, member, project } = await setUp(
			"desk-book-66",
			"deposit_pending",
		);
		await inTenant(tenant, async () =>
			makeSession(tenant, project, await makeArtist(tenant)),
		);

		const result = await inTenant(tenant, () =>
			payments.record(tenant, member, project, cash("deposit")),
		);

		assert.isTrue(result.booked);
		assert.equal(result.status, "booked");
	});

	test("a deposit only while the project waits for it; session and balance in any status but declined", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner(
			"desk-status-66",
			"Black Needle",
		);
		const member = ownerMember(owner);

		for (const status of PROJECT_STATUSES) {
			const project = await inTenant(tenant, async () => {
				const made = await makeProject(tenant, await makeClient(tenant), {
					status,
				});
				await makeQuote(tenant, made);
				return made;
			});
			const record = (kind: "deposit" | "session" | "balance") =>
				reasonOf(() =>
					inTenant(tenant, () =>
						payments.record(tenant, member, project, cash(kind)),
					),
				);

			assert.equal(
				await record("deposit"),
				status === "deposit_pending" ? null : "deposit_not_pending",
				`deposit in ${status}`,
			);
			for (const kind of ["session", "balance"] as const) {
				assert.equal(
					await record(kind),
					status === "declined" ? "project_declined" : null,
					`${kind} in ${status}`,
				);
			}
		}
	});

	test("without a quote a desk payment is in NPR, and overpaying is allowed", async ({
		assert,
	}) => {
		const { tenant, member, project } = await setUp("desk-over-66", "booked");
		const direct = await inTenant(tenant, async () =>
			makeProject(tenant, await makeClient(tenant), { status: "booked" }),
		);

		const { payment } = await inTenant(tenant, () =>
			payments.record(tenant, member, direct, cash("balance", 800_000)),
		);
		assert.equal(payment.currency, "NPR");

		// The quote's total is NPR 15,000: NPR 20,000 at the desk is taken.
		await inTenant(tenant, () =>
			payments.record(tenant, member, project, cash("balance", 2_000_000)),
		);
		const money = await inTenant(tenant, () =>
			payments.forProject(tenant, project),
		);
		assert.equal(money.balance.due, -500_000n);
	});
});

test.group("PaymentService.refund", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a refund is a negative verified payment, up to what the project holds", async ({
		assert,
	}) => {
		const { owner, tenant, member, project } = await setUp(
			"refund-66",
			"booked",
		);
		await paid(tenant, project);

		const refund = await inTenant(tenant, () =>
			payments.refund(tenant, member, project, {
				method: "cash",
				amount: 100_000,
				note: "Goodwill",
			}),
		);
		assert.deepEqual(
			[
				refund.kind,
				refund.amount,
				refund.status,
				refund.verifiedByUserId,
				refund.note,
			],
			["refund", -100_000, "verified", owner.id, "Goodwill"],
		);

		try {
			await inTenant(tenant, () =>
				payments.refund(tenant, member, project, {
					method: "cash",
					amount: 250_000,
					note: null,
				}),
			);
			assert.fail("a refund above what is held must be refused");
		} catch (error) {
			assert.instanceOf(error, PaymentRuleError);
			assert.equal((error as PaymentRuleError).reason, "refund_too_large");
			assert.equal((error as PaymentRuleError).limit, 200_000);
		}
	});

	test("a closed project waiting for its deposit outcome refuses a plain refund", async ({
		assert,
	}) => {
		const { tenant, member, project } = await setUp(
			"refund-closed-66",
			"cancelled",
		);
		await paid(tenant, project);

		assert.equal(
			await reasonOf(() =>
				inTenant(tenant, () =>
					payments.refund(tenant, member, project, {
						method: "cash",
						amount: 100_000,
						note: null,
					}),
				),
			),
			"outcome_first",
		);
	});
});

test.group("PaymentService.reverse", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a reversal is a verified correction of minus the amount, naming the payment, in its currency and method", async ({
		assert,
	}) => {
		const { owner, tenant, member, project } = await setUp(
			"reverse-66",
			"booked",
		);
		const { payment: entry } = await inTenant(tenant, () =>
			payments.record(tenant, member, project, {
				kind: "balance",
				method: "esewa",
				amount: 450_000,
				note: null,
			}),
		);

		const { correction, reversed } = await inTenant(tenant, () =>
			payments.reverse(tenant, member, entry, "Typed the wrong amount"),
		);

		assert.equal(reversed.id, entry.id);
		assert.deepEqual(
			[
				correction.kind,
				correction.amount,
				correction.currency,
				correction.method,
				correction.correctsPaymentId,
				correction.status,
				correction.verifiedByUserId,
				correction.note,
			],
			[
				"correction",
				-450_000,
				"NPR",
				"esewa",
				entry.id,
				"verified",
				owner.id,
				"Typed the wrong amount",
			],
		);
	});

	test("reversing a deposit un-covers it but never moves the project", async ({
		assert,
	}) => {
		const { tenant, member, project } = await setUp("reverse-dep-66", "booked");
		const deposit = await paid(tenant, project);

		const { depositDue } = await inTenant(tenant, () =>
			payments.reverse(tenant, member, deposit, null),
		);

		assert.equal(depositDue, 300_000);
		await inTenant(tenant, () => project.refresh());
		assert.equal(project.status, "booked");
	});

	test("reversing a refund gives its money back to what the project holds", async ({
		assert,
	}) => {
		const { tenant, member, project } = await setUp("reverse-ref-66", "booked");
		await paid(tenant, project);
		const refund = await inTenant(tenant, () =>
			payments.refund(tenant, member, project, {
				method: "cash",
				amount: 300_000,
				note: null,
			}),
		);
		await inTenant(tenant, () =>
			payments.reverse(tenant, member, refund, null),
		);

		const money = await inTenant(tenant, () =>
			payments.forProject(tenant, project),
		);
		assert.equal(money.balance.paid, 300_000n);
		assert.equal(money.depositHeld, 300_000);
	});

	test("only a verified payment that isn't a reversal, and only once", async ({
		assert,
	}) => {
		const { tenant, member, project } = await setUp(
			"reverse-rules-66",
			"booked",
		);
		const deposit = await paid(tenant, project);
		const [waiting, rejected] = await inTenant(tenant, async () => [
			await makePayment(tenant, project),
			await makePayment(tenant, project, {
				status: "rejected",
				verifiedAt: DateTime.utc(),
			}),
		]);
		const reverse = (payment: Payment) =>
			reasonOf(() =>
				inTenant(tenant, () => payments.reverse(tenant, member, payment, null)),
			);

		assert.equal(await reverse(waiting), "not_reversible");
		assert.equal(await reverse(rejected), "not_reversible");
		assert.isNull(await reverse(deposit));
		assert.equal(await reverse(deposit), "already_reversed");
		const correction = await inTenant(tenant, () =>
			Payment.query().where("corrects_payment_id", deposit.id).firstOrFail(),
		);
		assert.equal(await reverse(correction), "not_reversible");
	});

	test("an artist can't record, refund or reverse", async ({ assert }) => {
		const { tenant, project } = await setUp("entries-artist-66", "booked");
		const deposit = await paid(tenant, project);
		const asha = await artistIn(tenant, "asha@entries-66.example");
		const artist = { userId: asha.id, role: "artist" as const };

		const refused: (() => Promise<unknown>)[] = [
			() => payments.record(tenant, artist, project, cash("balance")),
			() =>
				payments.refund(tenant, artist, project, {
					method: "cash",
					amount: 1,
					note: null,
				}),
			() => payments.reverse(tenant, artist, deposit, null),
		];
		for (const work of refused) {
			await assert.rejects(() => inTenant(tenant, work), /Row not found/);
		}
	});
});
