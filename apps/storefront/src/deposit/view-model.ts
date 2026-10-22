import type {
	DepositPage,
	DepositPaymentMethod,
	DepositState,
} from "@tattoo-drip/sdk";
import { fill } from "../intake/template.ts";
import { safeImageUrl, viberLink, whatsappLink } from "../studio/links.ts";
import { cleanLine, cleanText, graphemes } from "../studio/text.ts";
import { copy, type DepositMethodKind } from "./copy.ts";
import type { LoadProblem } from "./problems.ts";

/*
 * What the deposit page shows (TAT-65b), from the API's DepositPage. Pure.
 * Every string the API sends is plain text, cleaned here and rendered as
 * text; QR codes pass safeImageUrl (http or https only). Amounts are the
 * API's own text: the page never formats paisa.
 */

/** The kinds a screenshot can name (the contract's DepositPaymentMethod.kind). */
export const DEPOSIT_KINDS: readonly DepositMethodKind[] = [
	"fonepay",
	"esewa",
	"khalti",
	"bank",
];

const STATES: readonly DepositState[] = [
	"due",
	"submitted",
	"paid",
	"updating",
	"expired",
	"cancelled",
];

/** A brief longer than this many characters is folded, so the amount stays on a phone's first screen. */
export const LONG_BRIEF = 240;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

export interface MethodView {
	/**
	 * The method's identity, which survives the studio reordering its list
	 * between two reads (the page refetches when the tab regains focus): the
	 * kind and the account or wallet number as shown, `bank:01234567890123`
	 * (the number URL-encoded; empty for a QR-only method). Methods that can't
	 * be told apart that way (the same kind and number, or no number) take
	 * `#1`, `#2`… by their order among them. Never the place in the list.
	 */
	readonly id: string;
	readonly kind: DepositMethodKind;
	readonly label: string;
	/** The QR image's URL, or null (none, or not http(s)). */
	readonly qr: string | null;
	readonly accountName: string | null;
	/** The bank account number, or the eSewa or Khalti ID. */
	readonly accountNumber: string | null;
	readonly bankName: string | null;
}

export interface SessionView {
	/** The API's UTC instant, for <time dateTime>. */
	readonly startsAt: string;
	readonly artistName: string | null;
}

export interface DepositView {
	readonly state: DepositState;
	readonly brief: string | null;
	readonly briefLong: boolean;
	readonly artistName: string | null;
	/** The current quote's deposit, in paisa. */
	readonly amount: number;
	readonly amountText: string;
	/** What is still to pay, in paisa: sent back as `expectedAmount`. */
	readonly due: number;
	readonly dueText: string;
	/** Part of the deposit was already received. */
	readonly partial: boolean;
	/** The last day to pay (yyyy-mm-dd, the studio's timezone), or null. */
	readonly payBy: string | null;
	readonly payByText: string;
	readonly referenceCode: string;
	readonly lastProofRejected: boolean;
	readonly proofSubmittedAt: string | null;
	/** Only in `due`. */
	readonly methods: readonly MethodView[];
	/** The methods' kinds, once each, in the API's order: the "How did you pay?" choices. */
	readonly kinds: readonly DepositMethodKind[];
	readonly policy: string | null;
	/** `due`, with a way to pay and something to pay: the form shows. */
	readonly takesProof: boolean;
	/** Once `paid`, the project's next session (TAT-110); null otherwise. */
	readonly session: SessionView | null;
}

export function depositView(page: DepositPage): DepositView {
	const state: DepositState = STATES.includes(page.state)
		? page.state
		: "updating";
	const methods = state === "due" ? methodViews(page.paymentMethods) : [];
	const brief = cleanText(page.project.brief);
	const { amount, due } = page.deposit;
	return {
		state,
		brief,
		briefLong: brief !== null && Array.from(brief).length > LONG_BRIEF,
		artistName: cleanLine(page.project.artistName),
		amount,
		amountText: cleanLine(page.deposit.amountText) ?? "",
		due,
		dueText: cleanLine(page.deposit.dueText) ?? "",
		partial: due > 0 && due < amount,
		payBy: DAY.test(page.deposit.payBy) ? page.deposit.payBy : null,
		payByText: cleanLine(page.deposit.payByText) ?? "",
		referenceCode: cleanLine(page.referenceCode) ?? "",
		lastProofRejected: state === "due" && page.lastProofRejected === true,
		proofSubmittedAt: page.proofSubmittedAt,
		methods,
		kinds: [...new Set(methods.map((method) => method.kind))],
		policy: cleanText(page.depositPolicy),
		takesProof:
			state === "due" && methods.length > 0 && Number.isInteger(due) && due > 0,
		session: state === "paid" ? sessionView(page.nextSession) : null,
	};
}

/** The API's nextSession, or null: missing (an API before TAT-110), null, or a start that isn't a date. */
function sessionView(
	value: DepositPage["nextSession"] | undefined,
): SessionView | null {
	if (!value || typeof value.startsAt !== "string") return null;
	if (Number.isNaN(Date.parse(value.startsAt))) return null;
	return { startsAt: value.startsAt, artistName: cleanLine(value.artistName) };
}

/** The picked method while it is listed, else the first, else null. */
export function selectedMethod(
	methods: readonly MethodView[],
	picked: string | null,
): MethodView | null {
	return methods.find((method) => method.id === picked) ?? methods[0] ?? null;
}

/**
 * The client's pick of a way to pay, as an event: the method's identity, its
 * kind, and how many picks there have been, so a second pick of the same kind
 * (another bank account) is a new event too.
 */
export interface MethodPick {
	readonly id: string;
	readonly kind: DepositMethodKind;
	readonly count: number;
}

/** `previous` followed by the client picking `method`. */
export function pickMethod(
	previous: MethodPick | null,
	method: Pick<MethodView, "id" | "kind">,
): MethodPick {
	return {
		id: method.id,
		kind: method.kind,
		count: (previous?.count ?? 0) + 1,
	};
}

/**
 * What a pick sets in "How did you pay?", once: its kind when it is newer than
 * the last one applied (`appliedCount`) and the form offers it, else null. Only
 * a pick sets the answer; a re-render, a refetch, a reorder or a pick that has
 * gone from the list never does, and never undoes the client's own answer.
 */
export function answerFor(
	pick: MethodPick | null,
	appliedCount: number,
	kinds: readonly DepositMethodKind[],
): DepositMethodKind | null {
	if (!pick || pick.count === appliedCount) return null;
	return kinds.includes(pick.kind) ? pick.kind : null;
}

/** The studio's mark when it has no logo: its first user-perceived character, as typed. */
export function studioInitial(name: string): string {
	return graphemes(name.trim())[0] ?? "";
}

function methodViews(methods: readonly DepositPaymentMethod[]): MethodView[] {
	const seen = new Map<string, number>();
	return methods
		.filter((method) => DEPOSIT_KINDS.includes(method.kind))
		.map((method) => ({
			id: methodId(method, seen),
			kind: method.kind,
			label: cleanLine(method.label) ?? copy.form.kinds[method.kind],
			qr: safeImageUrl(method.qrImageUrl),
			accountName: cleanLine(method.accountName),
			accountNumber: cleanLine(method.accountNumber),
			bankName: cleanLine(method.bankName),
		}));
}

/** A method's identity (MethodView.id); `seen` counts the ones that came before with the same base. */
function methodId(
	method: DepositPaymentMethod,
	seen: Map<string, number>,
): string {
	const number = cleanLine(method.accountNumber) ?? "";
	const base = `${method.kind}:${encodeURIComponent(number)}`;
	const nth = seen.get(base) ?? 0;
	seen.set(base, nth + 1);
	return nth === 0 ? base : `${base}#${nth}`;
}

/** Today's date (yyyy-mm-dd) in `timeZone`, or null when this browser doesn't know the zone. */
export function todayIn(
	timeZone: string,
	now: Date = new Date(),
): string | null {
	try {
		const parts = new Intl.DateTimeFormat("en-US", {
			timeZone,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
		}).formatToParts(now);
		const part = (type: Intl.DateTimeFormatPartTypes) =>
			parts.find((each) => each.type === type)?.value;
		const year = part("year");
		const month = part("month");
		const day = part("day");
		return year && month && day ? `${year}-${month}-${day}` : null;
	} catch {
		return null;
	}
}

/** Whole days from `today` to `day` (both yyyy-mm-dd), or null. */
export function daysUntil(day: string, today: string): number | null {
	if (!DAY.test(day) || !DAY.test(today)) return null;
	const end = Date.parse(`${day}T00:00:00Z`);
	const start = Date.parse(`${today}T00:00:00Z`);
	return Number.isNaN(end) || Number.isNaN(start)
		? null
		: Math.round((end - start) / DAY_MS);
}

/** "Pay by 28 Oct 2026, in 10 days." The API's date always; the count only when it makes sense. */
export function payByLine(
	view: Pick<DepositView, "payBy" | "payByText">,
	today: string | null,
): string {
	const date = view.payByText;
	const days = view.payBy && today ? daysUntil(view.payBy, today) : null;
	if (days === 0) return fill(copy.due.payByToday, { date });
	if (days === 1) return fill(copy.due.payByTomorrow, { date });
	if (days !== null && days > 1) {
		return fill(copy.due.payByDays, { date, count: days });
	}
	return fill(copy.due.payBy, { date });
}

/**
 * When the screenshot came, as "18 Oct 2026, 2:05 pm" in `timeZone`, or null.
 * Assembled from Intl's parts (en-GB month names, like the platform's
 * formatDay), so no browser's spacing or capitals change it.
 */
export function formatReceived(
	iso: string | null,
	timeZone: string,
): string | null {
	if (!iso) return null;
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return null;
	try {
		const parts = new Intl.DateTimeFormat("en-GB", {
			timeZone,
			day: "numeric",
			month: "short",
			year: "numeric",
			hour: "numeric",
			minute: "2-digit",
			hour12: true,
		}).formatToParts(date);
		const part = (type: Intl.DateTimeFormatPartTypes) =>
			parts.find((each) => each.type === type)?.value ?? "";
		return `${part("day")} ${part("month")} ${part("year")}, ${part("hour")}:${part("minute")} ${part("dayPeriod").toLowerCase()}`;
	} catch {
		return null;
	}
}

/**
 * When the next session starts, as "Sat 24 Oct 2026, 11:00 am" in
 * `timeZone`, or null (not a date, or a zone this browser doesn't know: never
 * UTC, which would show a wrong time). Same parts as formatReceived.
 */
export function formatSessionStart(
	iso: string | null,
	timeZone: string,
): string | null {
	if (!iso) return null;
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return null;
	try {
		const parts = new Intl.DateTimeFormat("en-GB", {
			timeZone,
			weekday: "short",
			day: "numeric",
			month: "short",
			year: "numeric",
			hour: "numeric",
			minute: "2-digit",
			hour12: true,
		}).formatToParts(date);
		const part = (type: Intl.DateTimeFormatPartTypes) =>
			parts.find((each) => each.type === type)?.value ?? "";
		return `${part("weekday")} ${part("day")} ${part("month")} ${part("year")}, ${part("hour")}:${part("minute")} ${part("dayPeriod").toLowerCase()}`;
	} catch {
		return null;
	}
}

/** The sentence a state other than `due` shows (copy.states). */
export function stateTemplate(
	view: Pick<DepositView, "state" | "amount">,
	received: string | null,
): string {
	switch (view.state) {
		case "submitted":
			return received ? copy.states.submitted : copy.states.submittedUndated;
		case "paid":
			return view.amount === 0 ? copy.states.paidNone : copy.states.paid;
		case "updating":
			return copy.states.updating;
		case "expired":
			return copy.states.expired;
		case "cancelled":
			return copy.states.cancelled;
		case "due":
			return "";
	}
}

/**
 * The page's one h1 (TAT-106): what the message under it says, in a few
 * words. While the deposit loads (`null`, no problem) and while it is due, it
 * asks to pay the studio; a link that doesn't work, a rate limit and a read
 * that failed (`problem`, TAT-119) say so instead, and win over a page
 * already read (a replaced link must stop saying "Deposit paid").
 */
export function headingTemplate(
	view: Pick<DepositView, "state" | "amount"> | null,
	problem: LoadProblem | null = null,
): string {
	if (problem !== null) return copy.headings.load[problem];
	if (view === null) return copy.heading;
	switch (view.state) {
		case "due":
			return copy.heading;
		case "submitted":
			return copy.headings.submitted;
		case "paid":
			return view.amount === 0 ? copy.headings.paidNone : copy.headings.paid;
		case "updating":
			return copy.headings.updating;
		case "expired":
			return copy.headings.expired;
		case "cancelled":
			return copy.headings.cancelled;
	}
}

/**
 * The amount the state message shows with the reference code: what was sent
 * for `submitted`; for `paid`, the deposit as a receipt (TAT-106; its `due`
 * is then 0). Null for the other states and when no deposit was needed.
 */
export function receiptAmount(
	view: Pick<DepositView, "state" | "amount" | "amountText" | "dueText">,
): string | null {
	if (view.state === "submitted") return view.dueText;
	if (view.state === "paid" && view.amount > 0) return view.amountText;
	return null;
}

/** The studio's chat links on every state (spec ruling 9). */
export interface DepositContact {
	/** WhatsApp, the message prefilled with the reference code once it is known. */
	readonly whatsapp: string | null;
	readonly viber: string | null;
}

export function depositContact(
	shell: { readonly studioName: string; readonly phone: string | null },
	referenceCode: string | null,
): DepositContact {
	const text = referenceCode
		? fill(copy.whatsappText, {
				studio: shell.studioName,
				code: referenceCode,
			})
		: fill(copy.whatsappTextNoCode, { studio: shell.studioName });
	return {
		whatsapp: whatsappLink(shell.phone, text),
		viber: viberLink(shell.phone),
	};
}
