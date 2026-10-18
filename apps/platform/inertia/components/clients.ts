import type { ReferenceProps } from "~/components/inquiries";
import type { PaymentRowProps } from "~/components/payments";

/** One row of the clients list. */
export type ClientRow = {
	id: string;
	name: string;
	/** E.164, as stored; null only for an anonymized client. */
	phone: string | null;
	/** How many live projects they have. */
	projects: number;
	/** "today", "yesterday" or "N days ago". */
	lastActivityText: string;
};

export type ClientListProps = {
	search: string;
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
