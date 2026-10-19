import type {
	DepositPage,
	DepositPaymentMethod,
	DepositState,
} from "@tattoo-drip/sdk";
import { fill } from "../intake/copy.ts";
import { safeImageUrl, viberLink, whatsappLink } from "../studio/links.ts";
import { cleanLine, cleanText } from "../studio/text.ts";
import { copy, type DepositMethodKind } from "./copy.ts";

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
	/** Stable for React keys: the method's place in the API's list. */
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
	};
}

function methodViews(methods: readonly DepositPaymentMethod[]): MethodView[] {
	return methods
		.filter((method) => DEPOSIT_KINDS.includes(method.kind))
		.map((method, index) => ({
			id: `method-${index}`,
			kind: method.kind,
			label: cleanLine(method.label) ?? copy.form.kinds[method.kind],
			qr: safeImageUrl(method.qrImageUrl),
			accountName: cleanLine(method.accountName),
			accountNumber: cleanLine(method.accountNumber),
			bankName: cleanLine(method.bankName),
		}));
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
