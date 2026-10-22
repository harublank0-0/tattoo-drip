import { DateTime } from "luxon";
import { daysAgoText } from "#modules/projects/contact";
import type { ProjectStatus } from "#modules/projects/models/tattoo_project";
import { isExpired, todayIn, validUntil } from "#modules/projects/quotes";
import { dayBounds } from "#modules/scheduling/calendar";

/**
 * What waits on a project, and on whom (TAT-107): the rules behind Today's "Needs you" and "Waiting
 * on clients", and TAT-109's "waiting" line. Pure: WaitingService gathers the facts from each
 * module's own service and calls these.
 */

/** Studio days, today included, in which a price that runs out needs a nudge. */
export const QUOTE_ENDING_DAYS = 3;
/** An unpaid deposit link needs a nudge once it is this many days (72 hours) old. */
export const DEPOSIT_CHASE_DAYS = 3;
/** Today shows at most this many rows per group. */
export const TODAY_ROWS = 5;

const DAY_MS = 86_400_000;
const QUOTE_STATUSES: readonly ProjectStatus[] = [
	"quoted",
	"on_hold",
	"deposit_pending",
];

export type NeedsYouReason =
	| "proof_to_check"
	| "price_to_send"
	| "quote_ending"
	| "deposit_link_missing"
	| "deposit_unpaid"
	| "no_session";
export type ClientWaitReason =
	| "price_sent"
	| "on_hold"
	| "deposit_link_sent"
	| "deposit_due";

export type Waiting =
	| { side: "studio"; reason: NeedsYouReason }
	| { side: "client"; reason: ClientWaitReason };

/** What the rules read about one project. Never sent to a page as it is: it holds owner facts. */
export type WaitingFacts = {
	status: ProjectStatus;
	/** When the project was made (accepted or booked). */
	since: DateTime;
	/** A deposit screenshot waits for an owner. */
	proofWaiting: boolean;
	/** The current quote of a quoted, on_hold or deposit_pending project; null otherwise. */
	quote: {
		issuedAt: DateTime;
		expiresAt: DateTime;
		depositAmount: number;
	} | null;
	/** The current quote's deposit is covered (a zero deposit is); false without a quote. */
	depositSettled: boolean;
	/** The project's deposit link (owners only): when the current one was made, whether it opens. */
	depositLink: { madeAt: DateTime; works: boolean } | null;
	/** A tattoo session is scheduled. */
	scheduledTattoo: boolean;
};

export type WaitingContext = {
	isOwner: boolean;
	now: DateTime;
	timezone: string;
};

const plusDays = (date: string, days: number) =>
	DateTime.fromISO(date, { zone: "utc" }).plus({ days }).toFormat("yyyy-MM-dd");

/** The studio's midnight QUOTE_ENDING_DAYS days ahead: a quote expiring by then ends soon. */
export function quoteEndingBefore(now: DateTime, timezone: string): DateTime {
	return dayBounds(
		plusDays(todayIn(timezone, now), QUOTE_ENDING_DAYS),
		timezone,
	).from;
}

/** Whether the quote's expiry would still cancel the project (ProjectService's expiry rule). */
function expiryWouldCancel(
	facts: WaitingFacts,
	depositAmount: number,
): boolean {
	if (facts.status === "deposit_pending") return !facts.depositSettled;
	return depositAmount === 0 || !facts.depositSettled;
}

/** The project's one waiting state, or null when nothing waits (first rule that matches wins). */
export function waitingOf(
	facts: WaitingFacts,
	{ isOwner, now, timezone }: WaitingContext,
): Waiting | null {
	if (facts.proofWaiting) {
		return isOwner ? { side: "studio", reason: "proof_to_check" } : null;
	}
	const { status, quote } = facts;
	if (status === "reviewing")
		return { side: "studio", reason: "price_to_send" };
	if (QUOTE_STATUSES.includes(status) && quote) {
		// An expired quote is the sweep's, and the Projects list's flags', not Today's.
		if (isExpired(quote, now)) return null;
		if (
			expiryWouldCancel(facts, quote.depositAmount) &&
			quote.expiresAt.toMillis() <= quoteEndingBefore(now, timezone).toMillis()
		) {
			return { side: "studio", reason: "quote_ending" };
		}
	}
	if (status === "deposit_pending") {
		if (facts.depositSettled) {
			return facts.scheduledTattoo
				? null
				: { side: "studio", reason: "no_session" };
		}
		if (!isOwner) return { side: "client", reason: "deposit_due" };
		const link = facts.depositLink;
		if (!link?.works) return { side: "studio", reason: "deposit_link_missing" };
		return now.toMillis() - link.madeAt.toMillis() >=
			DEPOSIT_CHASE_DAYS * DAY_MS
			? { side: "studio", reason: "deposit_unpaid" }
			: { side: "client", reason: "deposit_link_sent" };
	}
	if (status === "booked") {
		return facts.scheduledTattoo
			? null
			: { side: "studio", reason: "no_session" };
	}
	if (status === "quoted") return { side: "client", reason: "price_sent" };
	if (status === "on_hold") return { side: "client", reason: "on_hold" };
	return null;
}

/** When a quote ends, for people: "today", "tomorrow" or "on Sat 24 Oct" (its last valid day). */
function endsText(
	expiresAt: DateTime,
	now: DateTime,
	timezone: string,
): string {
	const today = todayIn(timezone, now);
	const last = validUntil(expiresAt, timezone);
	if (last <= today) return "today";
	if (last === plusDays(today, 1)) return "tomorrow";
	const day = DateTime.fromISO(last, { zone: "utc" })
		.setLocale("en-GB")
		.toFormat("ccc d LLL");
	return `on ${day}`;
}

/** The row's words for a waiting state: short, specific, no jargon. */
export function waitingText(
	waiting: Waiting,
	facts: WaitingFacts,
	now: DateTime,
	timezone: string,
): string {
	const ago = (at: DateTime) => daysAgoText(at, timezone, now);
	switch (waiting.reason) {
		case "proof_to_check":
			return "Deposit screenshot to check";
		case "price_to_send":
			return `Accepted ${ago(facts.since)}, no price yet`;
		case "quote_ending": {
			const ends = facts.quote
				? `The price ends ${endsText(facts.quote.expiresAt, now, timezone)}`
				: "The price ends soon";
			return facts.status === "deposit_pending"
				? `Deposit not paid. ${ends}`
				: ends;
		}
		case "deposit_link_missing":
			return facts.depositLink
				? "The deposit link stopped working"
				: "No deposit link yet";
		case "deposit_unpaid":
			return facts.depositLink
				? `Deposit not paid, link made ${ago(facts.depositLink.madeAt)}`
				: "Deposit not paid";
		case "no_session":
			return facts.status === "booked"
				? "Booked, no session in the calendar"
				: "Deposit paid, no session booked";
		case "price_sent":
			return facts.quote
				? `Price sent ${ago(facts.quote.issuedAt)}`
				: "Price sent";
		case "on_hold":
			return "On hold";
		case "deposit_link_sent":
			return facts.depositLink
				? `Deposit link sent ${ago(facts.depositLink.madeAt)}`
				: "Deposit link sent";
		case "deposit_due":
			return "Waiting for the deposit";
	}
}

/**
 * The card on the project page where the member acts on each reason (an element id there), or null
 * for the top of the page. TAT-108 keeps these ids when it restructures the page.
 */
export const WAITING_HASH: Record<
	NeedsYouReason | ClientWaitReason,
	string | null
> = {
	proof_to_check: "payments",
	price_to_send: "quote-form",
	quote_ending: "quote",
	deposit_link_missing: "deposit",
	deposit_unpaid: "deposit",
	no_session: "sessions",
	price_sent: "quote",
	on_hold: null,
	deposit_link_sent: "deposit",
	deposit_due: null,
};

export type TodayGroupKey =
	| "proofs"
	| "requests"
	| "prices"
	| "ending"
	| "deposits"
	| "sessions";

/** Today's "Needs you" groups, in page order. */
export const TODAY_GROUP_ORDER: readonly TodayGroupKey[] = [
	"proofs",
	"requests",
	"prices",
	"ending",
	"deposits",
	"sessions",
];

/** The "Needs you" group a studio reason belongs to. */
export function groupOf(reason: NeedsYouReason): TodayGroupKey {
	switch (reason) {
		case "proof_to_check":
			return "proofs";
		case "price_to_send":
			return "prices";
		case "quote_ending":
			return "ending";
		case "deposit_link_missing":
		case "deposit_unpaid":
			return "deposits";
		case "no_session":
			return "sessions";
	}
}

/** When the wait began: the sort key, oldest first. */
export function sinceOf(waiting: Waiting, facts: WaitingFacts): DateTime {
	switch (waiting.reason) {
		case "quote_ending":
			return facts.quote?.expiresAt ?? facts.since;
		case "deposit_unpaid":
		case "deposit_link_sent":
			return facts.depositLink?.madeAt ?? facts.since;
		case "price_sent":
			return facts.quote?.issuedAt ?? facts.since;
		default:
			return facts.since;
	}
}
