import { test } from "@japa/runner";
import { DateTime } from "luxon";
import {
	balanceOf,
	decidedLate,
	depositMoney,
	formatSignedMoney,
	type LedgerPayment,
	netPaid,
	settleableDeposit,
} from "#modules/payments/ledger";

let next = 0;
/** A verified NPR deposit of NPR 3,000 unless overridden. */
function pay(over: Partial<LedgerPayment> = {}): LedgerPayment {
	next += 1;
	return {
		id: `p${next}`,
		kind: "deposit",
		amount: 300_000,
		currency: "NPR",
		status: "verified",
		correctsPaymentId: null,
		verifiedAt: DateTime.utc(),
		...over,
	};
}

const fixed = (fixedPrice: number, currency = "NPR") => ({
	kind: "fixed" as const,
	fixedPrice,
	hourlyRate: null,
	estimatedMinutes: null,
	currency,
});
const hourly = (hourlyRate: number, estimatedMinutes: number) => ({
	kind: "hourly" as const,
	fixedPrice: null,
	hourlyRate,
	estimatedMinutes,
	currency: "NPR",
});

test.group("depositMoney", () => {
	test("sums verified deposits in the currency; waiting, rejected, other kinds and currencies don't count", ({
		assert,
	}) => {
		assert.equal(
			depositMoney(
				[
					pay(),
					pay({ amount: 100_000 }),
					pay({ status: "submitted" }),
					pay({ status: "rejected" }),
					pay({ kind: "session" }),
					pay({ kind: "balance" }),
					pay({ kind: "refund", amount: -50_000 }),
					pay({ currency: "USD" }),
				],
				"NPR",
			),
			400_000,
		);
	});

	test("a reversal of a deposit subtracts it", ({ assert }) => {
		const deposit = pay();
		assert.equal(
			depositMoney(
				[
					deposit,
					pay({
						kind: "correction",
						amount: -300_000,
						correctsPaymentId: deposit.id,
					}),
				],
				"NPR",
			),
			0,
		);
	});

	test("a reversed refund is not deposit money (the latent TAT-36 bug)", ({
		assert,
	}) => {
		const deposit = pay();
		const refund = pay({ kind: "refund", amount: -300_000 });
		const reversal = pay({
			kind: "correction",
			amount: 300_000,
			correctsPaymentId: refund.id,
		});
		assert.equal(depositMoney([deposit, refund, reversal], "NPR"), 300_000);
	});

	test("a reversal of a session payment, or of a payment not in the list, doesn't count", ({
		assert,
	}) => {
		const session = pay({ kind: "session" });
		assert.equal(
			depositMoney(
				[
					session,
					pay({
						kind: "correction",
						amount: -300_000,
						correctsPaymentId: session.id,
					}),
					pay({
						kind: "correction",
						amount: -300_000,
						correctsPaymentId: "elsewhere",
					}),
				],
				"NPR",
			),
			0,
		);
	});
});

test.group("netPaid", () => {
	test("every verified payment in the currency, signed", ({ assert }) => {
		const deposit = pay();
		assert.equal(
			netPaid(
				[
					deposit,
					pay({ kind: "session", amount: 500_000 }),
					pay({ kind: "refund", amount: -100_000 }),
					pay({
						kind: "correction",
						amount: -300_000,
						correctsPaymentId: deposit.id,
					}),
					pay({ status: "submitted" }),
					pay({ status: "rejected" }),
					pay({ currency: "USD" }),
				],
				"NPR",
			),
			400_000n,
		);
		assert.equal(netPaid([], "NPR"), 0n);
	});
});

test.group("balanceOf", () => {
	test("no quote: no total and no balance due; what was paid counts in NPR", ({
		assert,
	}) => {
		assert.deepEqual(balanceOf(null, [pay({ kind: "balance" })]), {
			currency: "NPR",
			total: null,
			paid: 300_000n,
			due: null,
		});
	});

	test("the total minus what was paid: due, paid in full and overpaid", ({
		assert,
	}) => {
		const quote = fixed(1_500_000);
		assert.equal(balanceOf(quote, []).due, 1_500_000n);
		assert.equal(balanceOf(quote, [pay()]).due, 1_200_000n);
		assert.equal(
			balanceOf(quote, [pay(), pay({ kind: "balance", amount: 1_200_000 })])
				.due,
			0n,
		);
		assert.equal(
			balanceOf(quote, [pay({ kind: "balance", amount: 1_550_000 })]).due,
			-50_000n,
		);
		assert.equal(
			balanceOf(quote, [pay(), pay({ kind: "refund", amount: -300_000 })]).due,
			1_500_000n,
			"a refund raises the balance due",
		);
	});

	test("payments in another currency than the quote's are left out", ({
		assert,
	}) => {
		const balance = balanceOf(fixed(10_000, "USD"), [pay()]);
		assert.equal(balance.currency, "USD");
		assert.equal(balance.paid, 0n);
		assert.equal(balance.due, 10_000n);
	});

	test("an hourly total is bigint past 2^53 and rounds half away from zero", ({
		assert,
	}) => {
		const max = 2_147_483_647;
		const huge = balanceOf(hourly(max, max), []);
		assert.equal(huge.total, (BigInt(max) * BigInt(max) * 2n + 60n) / 120n);
		assert.isAbove(Number(huge.total), Number.MAX_SAFE_INTEGER);
		// 90 paisa an hour for one minute is 1.5 paisa: 2. 30 for one minute
		// is 0.5: 1. 20 for one minute is 0.33: 0.
		assert.equal(balanceOf(hourly(90, 1), []).total, 2n);
		assert.equal(balanceOf(hourly(30, 1), []).total, 1n);
		assert.equal(balanceOf(hourly(20, 1), []).total, 0n);
	});
});

test.group("settleableDeposit", () => {
	test("the deposit money the project still holds: the smaller of the deposit and what it holds", ({
		assert,
	}) => {
		assert.equal(settleableDeposit([pay()], "NPR"), 300_000);
		// A session payment is not deposit money, however much was paid.
		assert.equal(
			settleableDeposit(
				[pay(), pay({ kind: "session", amount: 500_000 })],
				"NPR",
			),
			300_000,
		);
		// A refund before the close lowers what is held, not the deposit.
		assert.equal(
			settleableDeposit(
				[pay(), pay({ kind: "refund", amount: -200_000 })],
				"NPR",
			),
			100_000,
		);
	});

	test("a deposit already refunded in full, or refunded beyond it, leaves nothing to settle", ({
		assert,
	}) => {
		assert.equal(
			settleableDeposit(
				[pay(), pay({ kind: "refund", amount: -300_000 })],
				"NPR",
			),
			0,
		);
		assert.equal(
			settleableDeposit(
				[
					pay(),
					pay({ kind: "refund", amount: -300_000 }),
					pay({ kind: "refund", amount: -300_000 }),
				],
				"NPR",
			),
			0,
		);
		assert.equal(settleableDeposit([], "NPR"), 0);
	});

	test("another currency and waiting payments are left out", ({ assert }) => {
		assert.equal(
			settleableDeposit(
				[
					pay({ currency: "USD" }),
					pay({ status: "submitted", verifiedAt: null }),
				],
				"NPR",
			),
			0,
		);
	});

	test("a reversed refund gives its money back to the deposit, a reversed deposit takes it away", ({
		assert,
	}) => {
		const deposit = pay();
		const refund = pay({ kind: "refund", amount: -300_000 });
		const reverse = (target: LedgerPayment) =>
			pay({
				kind: "correction",
				amount: -target.amount,
				correctsPaymentId: target.id,
			});

		assert.equal(
			settleableDeposit([deposit, refund, reverse(refund)], "NPR"),
			300_000,
		);
		assert.equal(settleableDeposit([deposit, reverse(deposit)], "NPR"), 0);
	});
});

test.group("decidedLate", () => {
	const expiry = DateTime.utc().minus({ hours: 1 });
	const before = expiry.minus({ hours: 1 });
	const after = expiry.plus({ minutes: 30 });

	test("a waiting screenshot is a decision still owed", ({ assert }) => {
		assert.isTrue(
			decidedLate([pay({ status: "submitted", verifiedAt: null })], expiry),
		);
		assert.isFalse(decidedLate([], expiry));
	});

	test("a rejection at or after the expiry is late; one before it isn't", ({
		assert,
	}) => {
		assert.isTrue(
			decidedLate([pay({ status: "rejected", verifiedAt: after })], expiry),
		);
		assert.isTrue(
			decidedLate([pay({ status: "rejected", verifiedAt: expiry })], expiry),
		);
		assert.isFalse(
			decidedLate([pay({ status: "rejected", verifiedAt: before })], expiry),
		);
	});

	test("reversing a deposit at or after the expiry is late; reversing a refund isn't", ({
		assert,
	}) => {
		const deposit = pay({ verifiedAt: before });
		const refund = pay({
			kind: "refund",
			amount: -300_000,
			verifiedAt: before,
		});
		const reverse = (target: LedgerPayment, at: DateTime) =>
			pay({
				kind: "correction",
				amount: -target.amount,
				correctsPaymentId: target.id,
				verifiedAt: at,
			});

		assert.isTrue(decidedLate([deposit, reverse(deposit, after)], expiry));
		assert.isFalse(decidedLate([deposit, reverse(deposit, before)], expiry));
		assert.isFalse(decidedLate([refund, reverse(refund, after)], expiry));
	});

	test("a deposit verified or recorded at or after the expiry is late too; one before it isn't", ({
		assert,
	}) => {
		assert.isTrue(decidedLate([pay({ verifiedAt: after })], expiry));
		assert.isTrue(decidedLate([pay({ verifiedAt: expiry })], expiry));
		assert.isFalse(decidedLate([pay({ verifiedAt: before })], expiry));
	});

	test("only decisions about the deposit count: a session payment, a balance payment or a refund after the expiry don't", ({
		assert,
	}) => {
		for (const kind of ["session", "balance"] as const) {
			assert.isFalse(decidedLate([pay({ kind, verifiedAt: after })], expiry));
		}
		assert.isFalse(
			decidedLate(
				[pay({ kind: "refund", amount: -100_000, verifiedAt: after })],
				expiry,
			),
		);
	});
});

test.group("formatSignedMoney", () => {
	test("money going back gets a minus sign", ({ assert }) => {
		assert.equal(formatSignedMoney(300_000), "NPR 3,000");
		assert.equal(formatSignedMoney(-300_000n), "−NPR 3,000");
		assert.equal(formatSignedMoney(-150), "−NPR 1.50");
		assert.equal(formatSignedMoney(0), "NPR 0");
	});
});
