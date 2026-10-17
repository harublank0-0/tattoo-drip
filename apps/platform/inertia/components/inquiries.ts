/** One row of the inbox. */
export type InquiryRow = {
	id: string;
	contactName: string;
	idea: string;
	placement: string;
	approximateSize: string;
	preferredArtistName: string | null;
	receivedText: string;
	/** How many reference images came with it. */
	references: number;
	status: string;
	/** "28 Oct 2026" once decided. */
	decidedOn: string | null;
	/** The project an accepted inquiry became. */
	projectId: string | null;
};

export type InboxListProps = {
	view: "new" | "decided";
	newCount: number;
	inquiries: InquiryRow[];
	page: { current: number; last: number; total: number };
};

/** A reference image with a signed URL (valid for a few minutes). */
export type ReferenceProps = {
	id: string;
	url: string;
	width: number;
	height: number;
};

export type InquiryPageProps = {
	inquiry: {
		id: string;
		clientId: string;
		status: string;
		contactName: string;
		contactPhone: string | null;
		contactEmail: string | null;
		idea: string;
		placement: string;
		approximateSize: string;
		preferredDates: string;
		budget: string | null;
		source: string;
		preferredArtistName: string | null;
		receivedText: string;
		decidedOn: string | null;
	};
	references: ReferenceProps[];
	/** While the inquiry is new: the artist to pre-select and the choices. */
	accept: {
		artistId: string | null;
		choices: { id: string; name: string }[];
	} | null;
	projectId: string | null;
};

/** How the client found the studio, for people. */
export const SOURCE_LABELS: Record<string, string> = {
	instagram: "Instagram",
	facebook: "Facebook",
	tiktok: "TikTok",
	google: "Google",
	friend: "A friend",
	other: "Other",
};
