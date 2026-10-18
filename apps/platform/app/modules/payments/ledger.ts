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
 * expires at `expiresAt`: a deposit screenshot still waits for it, or it
 * rejected a deposit screenshot or reversed a deposit at or after the
 * expiry. ProjectService.expireQuote then spares the project, so whether
 * the sweep cancels it never depends on how late the owner decided
 * (TAT-66). A rejection or reversal before the expiry is not late: the
 * client had time to pay.
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
			(payment.kind === "deposit" && payment.status === "submitted") ||
			(payment.kind === "deposit" &&
				payment.status === "rejected" &&
				decidedAfter(payment)) ||
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
