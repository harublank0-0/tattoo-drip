import type { DateTime } from "luxon";
import type Payment from "#modules/payments/models/payment";
import type Quote from "#modules/projects/models/quote";
import {
	formatMoney,
	type QuoteAmounts,
	quoteTotal,
} from "#modules/projects/quotes";

/**
 * The money maths of a project's payments (TAT-66), pure so it can be
 * tested without a database. Amounts are signed int4 paisa and a project has
 * a handful of payments, so sums of amounts are exact in numbers; totals and
 * balances are bigint because an hourly total can pass 2^53.
 */
export type LedgerPayment = Pick<
	Payment,
	| "id"
	| "kind"
	| "amount"
	| "currency"
	| "status"
	| "correctsPaymentId"
	| "verifiedAt"
>;

/**
 * The deposit money in `currency`: the verified deposits plus the verified
 * corrections whose corrected payment is one of those deposits. A reversal
 * of a refund or a session payment is not deposit money, so a deposit, a
 * mistaken refund and the refund's reversal count the deposit once.
 */
export function depositMoney(
	payments: readonly LedgerPayment[],
	currency: string,
): number {
	const counted = payments.filter(
		(payment) => payment.status === "verified" && payment.currency === currency,
	);
	const deposits = new Set(
		counted.filter(({ kind }) => kind === "deposit").map(({ id }) => id),
	);
	return counted.reduce((sum, payment) => {
		const reversesDeposit =
			payment.kind === "correction" &&
			payment.correctsPaymentId !== null &&
			deposits.has(payment.correctsPaymentId);
		return payment.kind === "deposit" || reversesDeposit
			? sum + payment.amount
			: sum;
	}, 0);
}

/**
 * What the project holds in `currency`: every verified payment, signed
 * (refunds and reversals subtract). Waiting and rejected payments don't
 * count.
 */
export function netPaid(
	payments: readonly LedgerPayment[],
	currency: string,
): bigint {
	return payments
		.filter(
			(payment) =>
				payment.status === "verified" && payment.currency === currency,
		)
		.reduce((sum, { amount }) => sum + BigInt(amount), 0n);
}

/**
 * The deposit money still waiting for the studio's decision when a project
 * closes: the smaller of the deposit money in `currency` and what the
 * project holds (netPaid), never below zero. A refund at the desk before the
 * close does not lower the deposit (booking is unaffected, ruling 9) but
 * does lower what the studio can keep or give back, so a deposit already
 * refunded needs no outcome and can't be refunded twice. Payments that are
 * not deposit money (session payments, balance payments) are never part of
 * it.
 */
export function settleableDeposit(
	payments: readonly LedgerPayment[],
	currency: string,
): number {
	const deposit = BigInt(depositMoney(payments, currency));
	const held = netPaid(payments, currency);
	const smaller = deposit < held ? deposit : held;
	return smaller > 0n ? Number(smaller) : 0;
}

/** A project's money: its total (null without a price), what it holds and the balance due. */
export type Balance = {
	currency: string;
	total: bigint | null;
	paid: bigint;
	due: bigint | null;
};

/**
 * The balance due: the current quote's total (`quoteTotal`: the fixed price,
 * or the rate for the estimated minutes, rounded half away from zero) minus
 * netPaid in the quote's currency. Negative when overpaid. Without a quote
 * there is no total and nothing due, and what was paid counts in NPR.
 * Computed on every read, never stored.
 */
export function balanceOf(
	quote: (QuoteAmounts & Pick<Quote, "currency">) | null,
	payments: readonly LedgerPayment[],
): Balance {
	const currency = quote?.currency ?? "NPR";
	const paid = netPaid(payments, currency);
	if (!quote) return { currency, total: null, paid, due: null };
	const total = quoteTotal(quote);
	return { currency, total, paid, due: total - paid };
}

/**
 * Whether the studio's decision on the deposit came late for a quote that
 * expires at `expiresAt`, so that ProjectService.expireQuote spares the
 * project and the owner who decided chooses what happens next (revise,
 * take the rest at the desk, or withdraw): a deposit screenshot still waits
 * for a decision, or the studio decided on the deposit at or after the
 * expiry, by the decision's `verified_at`: rejected a screenshot, verified
 * one or recorded a deposit at the desk (money taken after the expiry), or
 * reversed a deposit. Whether the sweep cancels a project therefore never
 * depends on how late the owner decided or when the sweep runs (TAT-66). A
 * decision made before the expiry is not late: the client had time to pay,
 * and the expiry acts as usual. Session payments, balance payments and
 * refunds are not decisions about the deposit.
 */
export function decidedLate(
	payments: readonly LedgerPayment[],
	expiresAt: DateTime,
): boolean {
	const at = expiresAt.toMillis();
	const deposits = new Set(
		payments.filter(({ kind }) => kind === "deposit").map(({ id }) => id),
	);
	const decidedAfter = (payment: LedgerPayment) =>
		payment.verifiedAt !== null && payment.verifiedAt.toMillis() >= at;
	return payments.some(
		(payment) =>
			(payment.kind === "deposit" &&
				(payment.status === "submitted" || decidedAfter(payment))) ||
			(payment.kind === "correction" &&
				payment.status === "verified" &&
				payment.correctsPaymentId !== null &&
				deposits.has(payment.correctsPaymentId) &&
				decidedAfter(payment)),
	);
}

/**
 * Money for people with its sign: "NPR 3,000", or "−NPR 3,000" (U+2212)
 * for money going back. formatMoney itself takes amounts of zero or more.
 */
export function formatSignedMoney(paisa: bigint | number): string {
	const value = BigInt(paisa);
	return value < 0n ? `−${formatMoney(-value)}` : formatMoney(value);
}
