/**
 * The Reviews page and "Ask for a review" (Reviews and Fresh ink, slice 2):
 * the props' shapes, the page's address and its words. No imports, so the
 * unit tests load it. The server decides every row, status and toast; the
 * page lays them out.
 */

export type PostFilterName = "waiting" | "approved" | "declined";
export type ReviewFilterName = "all" | "reported";
export type ReviewsView = "posts" | "reviews";

/** The project a row belongs to. */
export type ReviewProjectRef = {
	id: string;
	clientName: string | null;
	piece: string;
	artistName: string | null;
} | null;

/** One photo or video of a post, through a 5-minute signed URL (private until published). */
export type ReviewMediaRow = {
	id: string;
	kind: "photo" | "video";
	state: "ready" | "processing" | "failed";
	thumbUrl: string | null;
	openUrl: string | null;
};

export type PostRow = {
	id: string;
	status: "waiting" | "approved" | "declined" | "unpublished";
	statusText: string;
	/** TattooDrip's takedown sentence, or null. */
	takenDown: string | null;
	published: boolean;
	dateText: string;
	/** Waiting again after the client changed an approved post. */
	edited: boolean;
	shownName: string;
	caption: string | null;
	styles: string[];
	placement: string | null;
	consentText: string;
	project: ReviewProjectRef;
	media: ReviewMediaRow[];
	canApprove: boolean;
	/** Why Approve is missing, or what it won't show (a video still processing, or one that failed). */
	approveNote: string | null;
	/** A video of the post is still processing: the page asks again quietly. */
	processing: boolean;
	canDecline: boolean;
	canUnpublish: boolean;
};

export type ReviewRow = {
	id: string;
	rating: number | null;
	ratingText: string;
	body: string;
	shownName: string;
	dateText: string;
	consentText: string;
	project: ReviewProjectRef;
	takenDown: string | null;
	reply: { text: string; dateText: string; takenDown: string | null } | null;
	canReply: boolean;
	report: {
		reasonText: string;
		note: string | null;
		dateText: string;
		/** TattooDrip still deciding, kept it up, or took it down. */
		outcome: "open" | "kept" | "removed";
	} | null;
	canReport: boolean;
};

export type ReviewsPageProps = {
	view: ReviewsView;
	postFilter: PostFilterName;
	reviewFilter: ReviewFilterName;
	artistId: string | null;
	artists: { id: string; name: string }[];
	waitingCount: number;
	posts: PostRow[];
	reviews: ReviewRow[];
	page: { current: number; last: number; total: number };
	reportReasons: { value: string; label: string }[];
	limits: { reply: number; reportNote: number };
};

/** What the Reviews page's address holds. */
export type ReviewsAddress = {
	view: ReviewsView;
	postFilter: PostFilterName;
	reviewFilter: ReviewFilterName;
	artistId: string | null;
};

/**
 * The Reviews page's address: only what differs from the defaults (Fresh
 * ink, waiting, all reviews, every artist, page 1), always in one order, so
 * one view has one address and it passes the server's `back` check.
 */
export function reviewsHref(
	base: string,
	address: ReviewsAddress,
	page = 1,
): string {
	const parts: string[] = [];
	if (address.view === "reviews") {
		parts.push("view=reviews");
		if (address.reviewFilter !== "all") {
			parts.push(`filter=${address.reviewFilter}`);
		}
	} else if (address.postFilter !== "waiting") {
		parts.push(`status=${address.postFilter}`);
	}
	if (address.artistId) {
		parts.push(`artist=${encodeURIComponent(address.artistId)}`);
	}
	if (page > 1) parts.push(`page=${page}`);
	return parts.length > 0 ? `${base}?${parts.join("&")}` : base;
}

/** The page's two views, as tabs: Fresh ink with its waiting count, then Reviews. */
export function viewTabs(waitingCount: number) {
	return [
		{
			value: "posts" as const,
			label: waitingCount > 0 ? `Fresh ink (${waitingCount})` : "Fresh ink",
		},
		{ value: "reviews" as const, label: "Reviews" },
	];
}

export const POST_FILTER_LABELS: Record<PostFilterName, string> = {
	waiting: "Waiting",
	approved: "Approved",
	declined: "Declined",
};

export const REVIEW_FILTER_LABELS: Record<ReviewFilterName, string> = {
	all: "All",
	reported: "Reported",
};

/** What an empty list says. */
export function emptyText(
	view: ReviewsView,
	postFilter: PostFilterName,
	reviewFilter: ReviewFilterName,
): string {
	if (view === "reviews") {
		return reviewFilter === "reported"
			? "No reviews you reported."
			: "No reviews yet. Ask for one on a project once the tattoo is done.";
	}
	if (postFilter === "waiting") return "No Fresh ink waiting for you.";
	if (postFilter === "approved") return "No approved Fresh ink yet.";
	return "No declined, unpublished or taken-down Fresh ink.";
}

/** The page's introduction: what the studio can and can't do (rulings 6 and 7). */
export const REVIEWS_INTRO =
	"Your clients' reviews and their photos of the healed tattoo. Reviews show as clients write them: you can answer each with one public reply and report abuse to TattooDrip, never hide or edit them. Fresh ink shows only once you approve it.";

/** The Decline question (ruling 7). */
export const DECLINE_QUESTION =
	"Decline this post? It won't show anywhere. The client only sees that it isn't shown by the studio.";

/** The Unpublish question (ruling 7). */
export const UNPUBLISH_QUESTION =
	"Unpublish this post? It comes off your page for good and its public copies are deleted. The client sees that it isn't shown by the studio.";

/** The Revoke question (ruling 4). */
export const REVOKE_QUESTION =
	"Revoke the link? The client can no longer open their review page. What they posted stays.";

/** Under the reply box. */
export function replyHint(max: number): string {
	return `One public reply, up to ${max.toLocaleString("en")} characters. It shows under the review where the client allowed it.`;
}

/** What a reported review's line says: when, why, the studio's note and what TattooDrip did. */
export function reportLine(report: {
	reasonText: string;
	note: string | null;
	dateText: string;
	outcome: "open" | "kept" | "removed";
}): string {
	const note = report.note ? ` Your note: “${report.note}”` : "";
	const outcome =
		report.outcome === "open"
			? "TattooDrip will decide; the review stays up until then."
			: report.outcome === "kept"
				? "TattooDrip kept it up."
				: "TattooDrip took it down.";
	return `Reported on ${report.dateText}. Reason: ${report.reasonText}.${note} ${outcome}`;
}

/** Whether any post shown has a video the worker still has: the page then asks again every few seconds. */
export function postsProcessing(
	posts: readonly { processing: boolean }[],
): boolean {
	return posts.some(({ processing }) => processing);
}

/** A tile whose signed URL failed (it expires after 5 minutes). */
export const MEDIA_UNAVAILABLE = "Image unavailable. Reload the page.";

/** Under the report form. */
export const REPORT_HINT =
	"TattooDrip decides. The review stays up until then.";

/** A media tile's accessible name. */
export function mediaLabel(
	item: Pick<ReviewMediaRow, "kind" | "state">,
	index: number,
	total: number,
): string {
	const what = item.kind === "video" ? "Video" : "Photo";
	const state =
		item.state === "processing"
			? ", still processing"
			: item.state === "failed"
				? ", couldn't be processed"
				: "";
	return `${what} ${index + 1} of ${total}${state}`;
}

/** "Ask for a review" on the project page: the link's dates as one line. */
export function linkDatesText(link: {
	madeText: string;
	expiresText: string;
	sentText: string | null;
}): string {
	const sent = link.sentText ? `Sent on ${link.sentText}` : "Not sent yet";
	return `${sent}. Made on ${link.madeText}, works until ${link.expiresText}.`;
}

/** The project page's review panel, as the server sends it. */
export type ReviewPanelProps = {
	link: {
		url: string;
		madeText: string;
		expiresText: string;
		sentText: string | null;
	} | null;
	lastText: string | null;
	text: string | null;
	message: { text: string; whatsappUrl: string; viberUrl: string } | null;
	devHost: boolean;
};

/** What the panel says before there is a link. */
export const ASK_INTRO =
	"Send the client a private link to rate the tattoo, write a review and show off the healed result. It works for a year.";
