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
