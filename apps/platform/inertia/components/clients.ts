import type { ReferenceProps } from "~/components/inquiries";
import type { PaymentRowProps } from "~/components/payments";

/** One row of the clients list. */
export type ClientRow = {
	id: string;
	name: string;
	/** E.164, as stored; null only for an anonymized client. */
	phone: string | null;
	/** Null when they gave none, or for an anonymized client. */
	email: string | null;
	/** "Sun 18 Oct 2026, 14:00–17:00": their next scheduled session; null for none. */
	nextSessionText: string | null;
	/** How many live projects they have. */
	projects: number;
	/** "today", "yesterday" or "N days ago". */
	lastActivityText: string;
};

export type ClientListProps = {
	search: string;
	/** `?filter=`: everyone, or only those with a session to come. */
	filter: "all" | "upcoming";
	clients: ClientRow[];
	page: { current: number; last: number; total: number };
};

export type ClientPageProps = {
	client: {
		id: string;
		name: string;
		phone: string | null;
		email: string | null;
		notes: string | null;
		/** The details were deleted (TAT-42): show none and allow no edit. */
		anonymized: boolean;
		/** "12 Oct 2026". */
		sinceText: string;
	};
	/** Chat and call links; null without a phone. */
	links: { whatsapp: string; viber: string; call: string } | null;
	projects: {
		id: string;
		brief: string;
		status: string;
		artistName: string | null;
		createdText: string;
	}[];
	inquiries: {
		id: string;
		idea: string;
		status: string;
		receivedText: string;
	}[];
	references: ReferenceProps[];
	/** The client's sessions, every status, newest first; at most 50 (Studio OS). */
	sessions: {
		id: string;
		projectId: string;
		whenText: string;
		/** yyyy-MM-dd in the studio's timezone: the calendar day it opens on. */
		date: string;
		kind: string;
		status: string;
		artistName: string | null;
		upcoming: boolean;
	}[];
	/** True when there may be older sessions than the ones listed. */
	sessionsCapped: boolean;
	/** Payments on the client's projects, newest first, and what their open projects still owe (TAT-66). */
	payments: {
		balanceDueText: string | null;
		rows: {
			id: string;
			projectId: string;
			projectBrief: string;
			kind: PaymentRowProps["kind"];
			amountText: string;
			status: PaymentRowProps["status"];
			dateText: string;
		}[];
	};
};

/** "Priya Thapa" is "PT", whole letters only (a Devanagari letter keeps its vowel sign). */
export function initialsOf(name: string): string {
	const words = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
	const segmenter =
		typeof Intl !== "undefined" && "Segmenter" in Intl
			? new Intl.Segmenter(undefined, { granularity: "grapheme" })
			: null;
	return words
		.map((word) =>
			segmenter ? ([...segmenter.segment(word)][0]?.segment ?? "") : word[0],
		)
		.join("")
		.toLocaleUpperCase();
}

/** The list's address: the search, the filter and the page, each only when set. */
export function clientsHref(
	base: string,
	{ search, filter, page }: { search: string; filter: string; page: number },
): string {
	const params = new URLSearchParams();
	if (search) params.set("q", search);
	if (filter !== "all") params.set("filter", filter);
	if (page > 1) params.set("page", String(page));
	const query = params.toString();
	return query ? `${base}?${query}` : base;
}
