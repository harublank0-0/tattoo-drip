import { DateTime } from "luxon";
import type Quote from "#modules/projects/models/quote";
import type { ProjectStatus } from "#modules/projects/models/tattoo_project";

/**
 * The statuses in which a project can be quoted or re-quoted. Issuing a
 * quote moves the project to `quoted`; from `booked` on, quotes are locked.
 */
export const QUOTABLE_STATUSES: readonly ProjectStatus[] = [
	"reviewing",
	"quoted",
	"on_hold",
	"deposit_pending",
];

/**
 * Booked or later: the quote is settled, so its expiry no longer cancels
 * anything (expireQuote and the sweep act only on quoted, on_hold and
 * deposit_pending, and a project never goes back to them from here). The
 * project page stops showing it.
 */
export const BOOKED_STATUSES: readonly ProjectStatus[] = [
	"booked",
	"in_progress",
	"completed",
	"healing_check",
];

/** What a quote's total is made of. */
export type QuoteAmounts = Pick<
	Quote,
	"kind" | "fixedPrice" | "hourlyRate" | "estimatedMinutes"
>;

/**
 * The quote's total in paisa: the fixed price, or the hourly rate for the
 * estimated minutes rounded half away from zero, the same as the database's
 * `quotes_deposit_within_total` check. A bigint, because a stored rate ×
 * minutes can pass 2^53 (see the backend conventions).
 */
export function quoteTotal(quote: QuoteAmounts): bigint {
	if (quote.kind === "fixed") return BigInt(quote.fixedPrice ?? 0);
	const product =
		BigInt(quote.hourlyRate ?? 0) * BigInt(quote.estimatedMinutes ?? 0);
	// round(product / 60) for a positive product, in integers.
	return (product * 2n + 60n) / 120n;
}

const GROUPED = new Intl.NumberFormat("en-IN");

/**
 * Paisa as rupees for people: "NPR 1,50,000", with South Asian digit
 * grouping, and the paisa only when there are some ("NPR 1,234.50").
 */
export function formatMoney(paisa: bigint | number): string {
	const value = BigInt(paisa);
	const rupees = GROUPED.format(value / 100n);
	const rest = value % 100n;
	return rest === 0n
		? `NPR ${rupees}`
		: `NPR ${rupees}.${String(rest).padStart(2, "0")}`;
}

/** Whole minutes as hours, without trailing zeros: 270 is "4.5". */
export function formatHours(minutes: number): string {
	return String(Number((minutes / 60).toFixed(2)));
}

/** The price line: "NPR 15,000", or "NPR 3,000/hour × about 5 h". */
export function priceText(quote: QuoteAmounts): string {
	if (quote.kind === "fixed") return formatMoney(quoteTotal(quote));
	return `${formatMoney(quote.hourlyRate ?? 0)}/hour × about ${formatHours(quote.estimatedMinutes ?? 0)} h`;
}

/** Whether the quote's expiry has passed: it is expired from `expires_at` on. */
export function isExpired(
	quote: Pick<Quote, "expiresAt">,
	now: DateTime = DateTime.now(),
): boolean {
	return now.toMillis() >= quote.expiresAt.toMillis();
}

/**
 * When a quote valid through `date` (yyyy-MM-dd, the studio's local date)
 * expires: the start of the next day in `timezone`, so a quote "valid until
 * 28 Oct" holds for all of 28 Oct where the studio is.
 */
export function expiresAtFor(date: string, timezone: string): DateTime {
	return DateTime.fromISO(date, { zone: timezone })
		.plus({ days: 1 })
		.startOf("day");
}

/**
 * The last local day a quote is valid (yyyy-MM-dd): the day before it
 * expires, in `timezone`.
 */
export function validUntil(expiresAt: DateTime, timezone: string): string {
	return expiresAt
		.setZone(timezone)
		.minus({ milliseconds: 1 })
		.toFormat("yyyy-MM-dd");
}

/** Today's date (yyyy-MM-dd) in `timezone`. */
export function todayIn(
	timezone: string,
	now: DateTime = DateTime.now(),
): string {
	return now.setZone(timezone).toFormat("yyyy-MM-dd");
}

/** A yyyy-MM-dd date for people: "28 Oct 2026". */
export function formatDay(date: string): string {
	return DateTime.fromISO(date, { locale: "en-GB" }).toFormat("d LLL yyyy");
}

export type QuoteMessageInput = {
	clientName: string;
	studioName: string;
	quote: QuoteAmounts & Pick<Quote, "depositAmount" | "expiresAt">;
	timezone: string;
};

/**
 * The quote as a chat message to the client, in English. TAT-52 turns the
 * one-tap messages into editable templates.
 */
export function quoteMessage({
	clientName,
	studioName,
	quote,
	timezone,
}: QuoteMessageInput): string {
	const firstName = clientName.trim().split(/\s+/)[0];
	const greeting = firstName ? `Hi ${firstName}` : "Hi";
	const total = formatMoney(quoteTotal(quote));
	const price =
		quote.kind === "fixed" ? total : `${priceText(quote)} ≈ ${total}`;
	const deposit =
		quote.depositAmount === 0
			? "No deposit needed."
			: `Deposit: ${formatMoney(quote.depositAmount)}.`;
	const until = formatDay(validUntil(quote.expiresAt, timezone));
	return `${greeting}, here is your quote from ${studioName}: ${price}. ${deposit} Valid until ${until}. Reply here to confirm.`;
}
