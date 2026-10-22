import type { DateTime } from "luxon";
import type { ContactVia } from "#modules/notifications/messages";
import { lastContactText } from "#modules/projects/contact";
import {
	CLOSED_STATUSES,
	type ProjectFilter,
	toProjectFilter,
} from "#modules/projects/moves";
import { formatMoney } from "#modules/projects/quotes";
import {
	groupOf,
	type NeedsYouReason,
	TODAY_GROUP_ORDER,
	type TodayGroupKey,
	type Waiting,
} from "#modules/projects/waiting";

/**
 * The Projects list (TAT-109): which projects a view holds, their order, a page, and the one line
 * a row says. Pure. Whether a project needs the member, its order among those that do and its
 * words are WaitingService.work's answer only (Today's and its badge's), so the two never disagree.
 */

/** How an open view is sorted: what needs you first (the default), or the longest since contact. */
export const LIST_SORTS = ["needs", "contact"] as const;
export type ListSort = (typeof LIST_SORTS)[number];

type StudioGroup = Exclude<TodayGroupKey, "requests">;
/** A Today group on its own (where Today's "See all" goes), or the projects waiting on clients. */
export type WaitingView = StudioGroup | "on_client";
export const WAITING_VIEWS: readonly WaitingView[] = [
	...TODAY_GROUP_ORDER.filter((key): key is StudioGroup => key !== "requests"),
	"on_client",
];

/** The chip a view sits under: a ProjectFilter, or everything that needs the member. */
export type ListFilter = ProjectFilter | "needs_you";

export type ListView = {
	filter: ListFilter;
	/** A Today group or the clients' side; null for a plain chip view. */
	waiting: WaitingView | null;
	sort: ListSort;
	page: number;
};

/** A view from the query string, every value checked against a fixed list; anything else is the default. */
export function toListView(query: Record<string, unknown>): ListView {
	const waiting = WAITING_VIEWS.find((key) => key === query.waiting) ?? null;
	let filter: ListFilter;
	if (waiting === "on_client") filter = "active";
	else if (waiting !== null || query.status === "needs_you")
		filter = "needs_you";
	else filter = toProjectFilter(query.status);
	return {
		filter,
		waiting,
		sort: LIST_SORTS.find((key) => key === query.sort) ?? "needs",
		page: Math.max(1, Number.parseInt(String(query.page ?? 1), 10) || 1),
	};
}

/** The filters whose rows come from the database a page at a time. */
export type ClosedFilter = "closed" | "declined" | "cancelled" | "completed";

/** Closed views come from the database a page at a time, the latest change first. */
export function isClosedFilter(filter: ListFilter): filter is ClosedFilter {
	return (
		filter === "closed" || CLOSED_STATUSES.some((status) => status === filter)
	);
}

/** What the list reads of WaitingService.work's answer (its items carry more). */
export type WorkIds = {
	needsYou: readonly {
		project: { id: string };
		waiting: { reason: NeedsYouReason };
	}[];
	onClient: readonly { project: { id: string } }[];
};

/** The ids of Needs you, of one Today group or of the clients' side, in work's order. */
export function waitingIds(
	view: Pick<ListView, "waiting">,
	work: WorkIds,
): string[] {
	if (view.waiting === "on_client") {
		return work.onClient.map(({ project }) => project.id);
	}
	const group = view.waiting;
	return work.needsYou
		.filter(
			({ waiting }) => group === null || groupOf(waiting.reason) === group,
		)
		.map(({ project }) => project.id);
}

/** What the order reads of a project. */
export type ListKey = {
	id: string;
	createdAt: DateTime;
	lastContactedAt: DateTime | null;
};

const oldestFirst = (a: ListKey, b: ListKey) =>
	a.createdAt.toMillis() - b.createdAt.toMillis() || a.id.localeCompare(b.id);

/** The longest since contact first: never contacted, then the oldest contact; ties oldest first. */
export function byContact(a: ListKey, b: ListKey): number {
	const at = (key: ListKey) => key.lastContactedAt?.toMillis() ?? -1;
	return at(a) - at(b) || oldestFirst(a, b);
}

/**
 * An open view in order. "needs": work's needsYou first, then its onClient, each in work's own
 * order, then the projects nothing waits on, oldest first. "contact": byContact.
 */
export function ordered<K extends ListKey>(
	keys: readonly K[],
	sort: ListSort,
	work: WorkIds,
): K[] {
	if (sort === "contact") return [...keys].sort(byContact);
	const position = new Map(
		[...work.needsYou, ...work.onClient].map(({ project }, index) => [
			project.id,
			index,
		]),
	);
	const rest = Number.MAX_SAFE_INTEGER;
	return [...keys].sort(
		(a, b) =>
			(position.get(a.id) ?? rest) - (position.get(b.id) ?? rest) ||
			oldestFirst(a, b),
	);
}

/** One page, `perPage` long; a page past the end is empty. */
export function pageOf<T>(rows: readonly T[], page: number, perPage: number) {
	return {
		rows: rows.slice((page - 1) * perPage, page * perPage),
		total: rows.length,
		lastPage: Math.max(1, Math.ceil(rows.length / perPage)),
	};
}

/** `rows` in the order of `ids`; an id without a row (gone meanwhile) is left out. */
export function inOrder<R extends { id: string }>(
	ids: readonly string[],
	rows: readonly R[],
): R[] {
	const byId = new Map(rows.map((row) => [row.id, row]));
	return ids.flatMap((id) => byId.get(id) ?? []);
}

/** A row's one line, and the card on the project page it opens. */
export type ListLine = { text: string; needsYou: boolean; hash: string | null };

/**
 * An owner's money facts on a row (PaymentService.listFlags). Only the two that WaitingService
 * can never say: a waiting screenshot and a lapsed price are always work()'s (it holds every
 * project an owner has a screenshot on, and spares an expired quote the sweep leaves alone),
 * so they never get a line of their own here.
 */
export type RowFlags = {
	depositToSettle: boolean;
	balanceDue: bigint | null;
};

/**
 * What a row says: what waits on it (work's item: the only thing that marks a row as needing the
 * member), else an owner's money fact (never marked, so the order and the counts stay Today's),
 * else null (a card then shows the next session).
 */
export function listLine(
	item: { waiting: Waiting; text: string; hash: string | null } | null,
	flags: RowFlags | null,
): ListLine | null {
	if (item) {
		return {
			text: item.text,
			needsYou: item.waiting.side === "studio",
			hash: item.hash,
		};
	}
	if (!flags) return null;
	if (flags.depositToSettle) {
		return {
			text: "Record whether the deposit was kept or refunded",
			needsYou: false,
			hash: "payments",
		};
	}
	if (flags.balanceDue !== null) {
		return {
			text: `${formatMoney(flags.balanceDue)} still due`,
			needsYou: false,
			hash: "payments",
		};
	}
	return null;
}

/** The last contact for the table, "Contacted 2 days ago on WhatsApp"; null when there was none. */
export function contactLine(
	at: DateTime | null,
	timezone: string,
	via: ContactVia,
	now: DateTime,
): string | null {
	if (!at) return null;
	const text = lastContactText(at, timezone, via, now);
	return text.charAt(0).toUpperCase() + text.slice(1);
}
