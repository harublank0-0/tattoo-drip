import type { DateTime } from "luxon";
import type { ReviewLinkRuleReason } from "#modules/reviews/errors";
import type { PostStatus } from "#modules/reviews/rules";
import type { StudioReviewRule } from "#modules/reviews/services/studio_review_service";

/**
 * The dashboard's words for reviews and Fresh ink (slice 2): the Reviews
 * page's statuses and the toasts of its actions, and "Ask for a review" on
 * the project page. Pure (the type imports are erased), so a unit test runs
 * it.
 */

/** Why the studio's action was refused, as its error toast says it. */
export const STUDIO_RULE_MESSAGES: Record<StudioReviewRule, string> = {
	not_waiting:
		"This post isn't waiting any more. The page shows it as it is now.",
	not_approved:
		"This post isn't shown any more. The page shows it as it is now.",
	processing: "A video is still processing. Approve the post once it's ready.",
	empty: "This post has no photos left: there is nothing to approve.",
	taken_down: "TattooDrip took this down, so it can't be changed.",
	reply_taken_down:
		"TattooDrip took your reply down, so it can't be changed or deleted.",
	already_reported: "You reported this already. TattooDrip will decide.",
};

/** A studio's report as TattooDrip left it: still to decide, kept up, or taken down. */
export type ReportOutcome = "open" | "kept" | "removed";

export function reportOutcome(review: {
	reportedAt: unknown;
	reportResolvedAt: unknown;
	takenDownAt: unknown;
}): ReportOutcome | null {
	if (!review.reportedAt) return null;
	if (review.takenDownAt) return "removed";
	return review.reportResolvedAt ? "kept" : "open";
}

/** Said by Approve when a video of the post couldn't be processed: it has no files to show. */
export const FAILED_VIDEO_NOTE =
	"A video couldn't be processed, so it won't be shown. The photos will.";

/** The toast after each action. */
export const STUDIO_DONE = {
	approvedShown: "Approved. It shows where the client allowed.",
	approvedKept:
		"Approved. The client hasn't allowed any page yet, so it's kept for you.",
	declined: "Declined. The client only sees that it isn't shown by the studio.",
	unpublished:
		"Unpublished. It's off your page and its public copies are deleted.",
	removeFailed: "Couldn't remove the public photos, try again.",
	replySaved: "Reply saved.",
	replyPosted: "Reply posted.",
	replyDeleted: "Reply deleted.",
	reported: "Reported to TattooDrip. The review stays up until they decide.",
} as const;

/** Why "Ask for a review" can't make a link now. */
export const LINK_RULE_MESSAGES: Record<ReviewLinkRuleReason, string> = {
	disabled: "Reviews aren't available yet.",
	not_done: "Ask for a review once the tattoo session is done.",
};

/** The toasts of "Ask for a review". */
export const LINK_DONE = {
	made: "Review link ready: send it to the client.",
	same: "This is the link you made before: send it again if you like.",
	revoked:
		"Link revoked. The client can't open it any more; what they posted stays.",
	none: "There was no link to revoke.",
} as const;

/** An instant as a day in the studio's timezone: "13 Nov 2026". */
export function dayText(at: DateTime, timezone: string): string {
	return at.setZone(timezone).setLocale("en-GB").toFormat("d LLL yyyy");
}

/**
 * The last day a link works, in the studio's timezone: the day before the
 * instant it expires ("Works until 12 Nov 2027").
 */
export function lastDayText(expiresAt: DateTime, timezone: string): string {
	return dayText(expiresAt.minus({ milliseconds: 1 }), timezone);
}

/**
 * A post's state as the Reviews page says it, for the studio: waiting,
 * approved and shown (or kept, without a surface), declined, unpublished,
 * or taken down by TattooDrip (whatever the decision; its sentence follows).
 */
export function postStatusText(post: {
	status: PostStatus;
	consentStudioPage: boolean;
	consentDiscover: boolean;
	takenDownAt?: unknown;
}): string {
	if (post.takenDownAt) return "Taken down by TattooDrip";
	if (post.status === "waiting") return "Waiting for you";
	if (post.status === "declined") return "Declined";
	if (post.status === "unpublished") return "Unpublished";
	return post.consentStudioPage || post.consentDiscover
		? "Approved: shown where the client allowed"
		: "Approved: the client allowed no page yet";
}

/** Where the client allowed it to show, in words. */
export function consentText(item: {
	consentStudioPage: boolean;
	consentDiscover: boolean;
}): string {
	if (item.consentStudioPage && item.consentDiscover) {
		return "Your page and TattooDrip Discover";
	}
	if (item.consentStudioPage) return "Your page only";
	if (item.consentDiscover) return "TattooDrip Discover only";
	return "Nowhere public: kept for you";
}

/** The stars of a rating as text for people and screen readers: "4 out of 5 stars". */
export function ratingText(rating: number | null): string {
	return rating === null ? "No rating" : `${rating} out of 5 stars`;
}
