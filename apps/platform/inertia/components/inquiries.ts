import type {
	CardMessageProps,
	ContactChannelName,
	ContactLinksProps,
} from "~/components/messages";
import type { StudioPageProps } from "~/components/studio_link";

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
	/** The last contact ("contacted today on WhatsApp (Inquiry received)"); null when never (TAT-52). */
	contactedText: string | null;
};

export type InboxListProps = {
	view: "new" | "decided";
	/** The studio link for the empty New view; null in the Decided view (TAT-101). */
	studioPage: StudioPageProps | null;
	newCount: number;
	inquiries: InquiryRow[];
	page: { current: number; last: number; total: number };
};

/** A reference image with signed URLs (valid for a few minutes). */
export type ReferenceProps = {
	id: string;
	/** The full image: what a tap opens. */
	url: string;
	/** What the grid shows: the signed 320 px copy, or the image itself when it has none. */
	thumbnailUrl: string;
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
	/** One-tap links to the client without a message; null without a phone (TAT-52). */
	contact: ContactLinksProps | null;
	/** The "received" message while the inquiry is new. */
	message: CardMessageProps | null;
	contactedText: string;
	/** The channel of the last contact, which the Message card leads with (TAT-104). */
	lastChannel: ContactChannelName | null;
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
