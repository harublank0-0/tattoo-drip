import type { DateTime } from "luxon";
import {
	netOf,
	PROVIDER_TEXT,
	REVIEW_TEXT,
	STATUS_TEXT,
	signedMoney,
	type Totals,
	TRANSACTION_PROVIDERS,
	TRANSACTION_STATUSES,
	TRANSACTION_TYPES,
	type TransactionFilters,
	type TransactionRecord,
	TYPE_TEXT,
} from "#modules/payments/transactions";
import { formatDay, formatMoney } from "#modules/projects/quotes";

export type TransactionRowProps = {
	id: string;
	type: string;
	typeText: string;
	status: string;
	statusText: string;
	providerText: string;
	online: boolean;
	amount: number;
	amountText: string;
	dateText: string;
	timeText: string;
	createdText: string;
	paidText: string | null;
	refundedText: string | null;
	projectId: string;
	projectBrief: string | null;
	clientId: string | null;
	clientName: string | null;
	note: string | null;
	providerRef: string | null;
	providerId: string | null;
	problem: string | null;
	/** "Check status" is offered: an online record not settled yet, or one that may have been refunded. */
	checkable: boolean;
};

export type TransactionsPageProps = {
	filters: TransactionFilters;
	periodText: string;
	rows: TransactionRowProps[];
	pagination: { page: number; lastPage: number; total: number };
	totals: {
		currency: string;
		gross: string;
		refunds: string;
		reversals: string | null;
		net: string;
		collectedCount: number;
		pending: string;
		started: string;
		review: string | null;
	}[];
	daily: {
		day: string;
		dayText: string;
		collected: string;
		refunded: string | null;
		share: number;
	}[];
	options: {
		statuses: { value: string; label: string }[];
		providers: { value: string; label: string }[];
		types: { value: string; label: string }[];
	};
};

/** The Transactions page's props: words, money text and the studio's dates. */
export function transactionsPage(input: {
	rows: TransactionRecord[];
	total: number;
	totals: Totals[];
	daily: { day: string; collected: number; refunded: number }[];
	filters: TransactionFilters;
	perPage: number;
	timezone: string;
}): TransactionsPageProps {
	const { timezone } = input;
	const local = (at: DateTime) => at.setZone(timezone);
	const day = (at: DateTime) => formatDay(local(at).toISODate() as string);
	const largest = Math.max(1, ...input.daily.map((d) => d.collected));
	return {
		filters: input.filters,
		periodText: `${formatDay(input.filters.from)} to ${formatDay(input.filters.to)}`,
		rows: input.rows.map((row) => ({
			id: row.id,
			type: row.type,
			typeText: TYPE_TEXT[row.type] ?? row.type,
			status: row.status,
			statusText: STATUS_TEXT[row.status] ?? row.status,
			providerText: row.provider
				? (PROVIDER_TEXT[row.provider as keyof typeof PROVIDER_TEXT] ??
					row.provider)
				: "Online",
			online: row.online,
			amount: row.amount,
			amountText: signedMoney(row.amount),
			dateText: day(row.occurredAt),
			timeText: local(row.occurredAt).toFormat("HH:mm"),
			createdText: `${day(row.createdAt)}, ${local(row.createdAt).toFormat("HH:mm")}`,
			paidText: row.settledAt
				? `${day(row.settledAt)}, ${local(row.settledAt).toFormat("HH:mm")}`
				: null,
			refundedText:
				row.onlineRefunded > 0
					? `${formatMoney(row.onlineRefunded)} refunded through PayBridgeNP`
					: null,
			projectId: row.projectId,
			projectBrief: row.projectBrief,
			clientId: row.clientId,
			clientName: row.clientName,
			note: row.note,
			providerRef: row.providerRef,
			providerId: row.providerId,
			problem: row.reviewReason
				? (REVIEW_TEXT[row.reviewReason] ?? row.reviewReason)
				: row.failureReason,
			checkable:
				row.online &&
				row.checkoutId !== null &&
				(row.status === "pending" ||
					row.status === "review" ||
					(row.source === "ledger" && row.type === "deposit")),
		})),
		pagination: {
			page: input.filters.page,
			lastPage: Math.max(1, Math.ceil(input.total / input.perPage)),
			total: input.total,
		},
		totals: input.totals.map((totals) => ({
			currency: totals.currency,
			gross: formatMoney(totals.gross),
			refunds: formatMoney(totals.refunds),
			reversals: totals.reversals !== 0 ? signedMoney(totals.reversals) : null,
			net: signedMoney(netOf(totals)),
			collectedCount: totals.collectedCount,
			pending: formatMoney(totals.pending),
			started: formatMoney(totals.started),
			review: totals.review > 0 ? formatMoney(totals.review) : null,
		})),
		daily: input.daily.map((entry) => ({
			day: entry.day,
			dayText: formatDay(entry.day),
			collected: formatMoney(entry.collected),
			refunded: entry.refunded > 0 ? formatMoney(entry.refunded) : null,
			share: Math.round((entry.collected / largest) * 100),
		})),
		options: {
			statuses: TRANSACTION_STATUSES.map((value) => ({
				value,
				label: STATUS_TEXT[value],
			})),
			providers: TRANSACTION_PROVIDERS.map((value) => ({
				value,
				label: PROVIDER_TEXT[value],
			})),
			types: TRANSACTION_TYPES.map((value) => ({
				value,
				label: TYPE_TEXT[value],
			})),
		},
	};
}
