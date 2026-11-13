import { DateTime } from "luxon";
import { formatMoney } from "#modules/projects/quotes";

/**
 * The studio's Transactions page (docs/payments-paybridgenp.md): its
 * customer-side money only, never TattooDrip's subscription billing. Pure:
 * the filters, the words, the totals' arithmetic and the CSV.
 */

export const TRANSACTION_TYPES = [
	"deposit",
	"session",
	"balance",
	"refund",
	"reversal",
] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const TRANSACTION_STATUSES = [
	"succeeded",
	"pending",
	"review",
	"failed",
	"rejected",
	"expired",
] as const;
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

export const TRANSACTION_PROVIDERS = [
	"cash",
	"bank",
	"esewa",
	"khalti",
	"fonepay",
] as const;
export type TransactionProvider = (typeof TRANSACTION_PROVIDERS)[number];

export const TYPE_TEXT: Record<TransactionType, string> = {
	deposit: "Deposit",
	session: "Session payment",
	balance: "Balance",
	refund: "Refund",
	reversal: "Reversal",
};

export const STATUS_TEXT: Record<TransactionStatus, string> = {
	succeeded: "Collected",
	pending: "Pending",
	review: "Needs review",
	failed: "Failed",
	rejected: "Rejected",
	expired: "Expired",
};

export const PROVIDER_TEXT: Record<TransactionProvider | "card", string> = {
	cash: "Cash",
	bank: "Bank transfer",
	esewa: "eSewa",
	khalti: "Khalti",
	fonepay: "Fonepay",
	card: "Card (test)",
};

export const REVIEW_TEXT: Record<string, string> = {
	amount_mismatch:
		"The amount paid differs from the checkout's. Not recorded: check it in PayBridgeNP and refund it there if needed.",
	currency_mismatch: "Paid in another currency. Not recorded.",
	mode_mismatch:
		"A test payment reported to a live connection, or the reverse. Not recorded.",
	session_mismatch: "The payment names another checkout. Not recorded.",
	metadata_mismatch:
		"The payment's details don't match this studio's checkout. Not recorded.",
	duplicate:
		"A second payment for a checkout that was already paid. Not recorded twice: refund it in PayBridgeNP.",
	unsupported_method:
		"Paid with a method TattooDrip doesn't record. Not recorded.",
	project_deleted:
		"The project was deleted before the payment arrived. Not recorded.",
};

/** The page's filters, validated; dates are the studio's days, both included. */
export type TransactionFilters = {
	from: string;
	to: string;
	status: TransactionStatus | null;
	provider: TransactionProvider | null;
	type: TransactionType | null;
	q: string | null;
	page: number;
};

/** The longest period one page or export covers. */
export const MAX_RANGE_DAYS = 366;
export const PER_PAGE = 25;
export const MAX_EXPORT_ROWS = 10_000;

/** A period of days, defaulting to the last 30 in the studio's time zone and never longer than a year. */
export function periodOf(
	from: string | null | undefined,
	to: string | null | undefined,
	timezone: string,
	now: DateTime = DateTime.utc(),
): { from: string; to: string; startsAt: DateTime; endsBefore: DateTime } {
	const today = now.setZone(timezone).startOf("day");
	let end = to ? DateTime.fromISO(to, { zone: timezone }) : today;
	if (!end.isValid) end = today;
	let start = from
		? DateTime.fromISO(from, { zone: timezone })
		: end.minus({ days: 29 });
	if (!start.isValid) start = end.minus({ days: 29 });
	if (start > end) [start, end] = [end, start];
	if (end.diff(start, "days").days > MAX_RANGE_DAYS - 1) {
		start = end.minus({ days: MAX_RANGE_DAYS - 1 });
	}
	return {
		from: start.toISODate() as string,
		to: end.toISODate() as string,
		startsAt: start.startOf("day").toUTC(),
		endsBefore: end.plus({ days: 1 }).startOf("day").toUTC(),
	};
}

/** One row of the page, as read from the database. */
export type TransactionRecord = {
	id: string;
	source: "ledger" | "online_payment" | "online_checkout";
	type: TransactionType;
	status: TransactionStatus;
	provider: string | null;
	online: boolean;
	/** Signed paisa: refunds and reversals of money in are negative. */
	amount: number;
	currency: string;
	createdAt: DateTime;
	settledAt: DateTime | null;
	occurredAt: DateTime;
	projectId: string;
	projectBrief: string | null;
	clientId: string | null;
	clientName: string | null;
	note: string | null;
	providerRef: string | null;
	providerId: string | null;
	failureReason: string | null;
	reviewReason: string | null;
	onlineRefunded: number;
	checkoutId: string | null;
};

/** The period's money, per currency (NPR in practice). */
export type Totals = {
	currency: string;
	/** Money in that was collected: verified deposits, session and balance payments. */
	gross: number;
	collectedCount: number;
	/** Money given back (a positive number). */
	refunds: number;
	/** Reversals of mistaken entries, signed (usually negative). */
	reversals: number;
	/** Screenshots waiting for the studio and online payments being confirmed. */
	pending: number;
	/** Online checkouts started and not paid yet. */
	started: number;
	/** Online payments held for review: not counted anywhere else. */
	review: number;
};

/** Collected money after refunds and reversals: never pending, failed or expired money. */
export function netOf(totals: Pick<Totals, "gross" | "refunds" | "reversals">) {
	return totals.gross - totals.refunds + totals.reversals;
}

export function signedMoney(paisa: number): string {
	return paisa < 0 ? `−${formatMoney(-paisa)}` : formatMoney(paisa);
}

/** "Black Needle Tattoo" style csv cell: quoted, and safe for spreadsheets. */
function textCell(value: string | null | undefined) {
	const text = value ?? "";
	// Quoting alone does not stop spreadsheets from evaluating formulas.
	const safe = /^[\t\r\n]|^\s*[=+\-@＝＋－＠]/u.test(text) ? `'${text}` : text;
	return `"${safe.replaceAll('"', '""')}"`;
}

export const CSV_COLUMNS = [
	"date",
	"time",
	"type",
	"status",
	"provider",
	"online",
	"amount",
	"currency",
	"client",
	"project",
	"provider_reference",
	"provider_id",
	"paid_at",
	"note",
	"problem",
];

/** The filtered rows as CSV, dates and times in the studio's time zone, amounts in rupees. */
export function transactionsCsv(
	rows: readonly TransactionRecord[],
	timezone: string,
): string {
	const lines = rows.map((row) => {
		const at = row.occurredAt.setZone(timezone);
		const amount = (row.amount / 100).toFixed(2);
		return [
			at.toISODate(),
			at.toFormat("HH:mm"),
			row.type,
			row.status,
			row.provider ?? "",
			row.online ? "yes" : "no",
			amount,
			row.currency,
			textCell(row.clientName),
			textCell(row.projectBrief?.slice(0, 120)),
			textCell(row.providerRef),
			textCell(row.providerId),
			row.settledAt ? (row.settledAt.setZone(timezone).toISO() ?? "") : "",
			textCell(row.note),
			textCell(
				row.reviewReason
					? (REVIEW_TEXT[row.reviewReason] ?? row.reviewReason)
					: row.failureReason,
			),
		].join(",");
	});
	return [CSV_COLUMNS.join(","), ...lines, ""].join("\r\n");
}
