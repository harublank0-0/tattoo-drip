import { isTattooApiError } from "@tattoo-drip/sdk";
import { copy } from "./copy.ts";
import type { Field, Problem } from "./view-model.ts";

/*
 * What the review page says for each API refusal (Reviews and Fresh ink):
 * a field's error (linked to its control), one notice above Save, or the
 * dead link, which replaces the page. Pure.
 */

/** A read's failure as the page shows it. */
export type LoadProblem = "dead" | "limited" | "failed";

/** A 404 at any time is the dead link (unknown, revoked, expired, or reviews off). */
export function isGone(error: unknown): boolean {
	return isTattooApiError(error) && error.status === 404;
}

export function loadProblemOf(error: unknown): LoadProblem {
	if (isGone(error)) return "dead";
	if (isTattooApiError(error) && error.status === 429) return "limited";
	return "failed";
}

/** The API's field paths, as the form's fields. */
const API_FIELDS: Record<string, Field> = {
	"review.rating": "rating",
	review: "body",
	"review.body": "body",
	shownName: "shownName",
	"post.caption": "caption",
	"post.placement": "placement",
	"post.styles": "styles",
	post: "media",
	photo: "media",
	upload: "media",
	"post.order": "media",
};

export type WriteOutcome =
	| { readonly kind: "gone" }
	| { readonly kind: "fields"; readonly problems: readonly Problem[] }
	| {
			readonly kind: "notice";
			readonly message: string;
			readonly retryAfter?: number;
	  };

/** A write's refusal (a submit, an upload, a delete) as the page shows it. */
export function writeOutcome(error: unknown): WriteOutcome {
	if (!isTattooApiError(error)) {
		return { kind: "notice", message: copy.errors.failed };
	}
	if (error.status === 404) return { kind: "gone" };
	switch (error.code) {
		case "validation_failed": {
			const problems: Problem[] = [];
			for (const [path, messages] of Object.entries(error.fields ?? {})) {
				const field =
					API_FIELDS[path] ?? (path.startsWith("review") ? "body" : "media");
				problems.push({ field, message: messages[0] ?? copy.errors.failed });
			}
			return problems.length > 0
				? { kind: "fields", problems }
				: { kind: "notice", message: copy.errors.failed };
		}
		case "post_needs_photo":
			return {
				kind: "fields",
				problems: [{ field: "media", message: copy.errors.postNeedsPhoto }],
			};
		case "post_full":
			return {
				kind: "fields",
				problems: [{ field: "media", message: copy.postFull }],
			};
		case "review_locked":
			return { kind: "notice", message: copy.errors.locked };
		case "challenge_failed":
			return { kind: "notice", message: copy.errors.challenge };
		case "challenge_unavailable":
			return { kind: "notice", message: copy.errors.challengeDown };
		case "remove_failed":
			return { kind: "notice", message: copy.errors.removeFailed };
		case "rate_limited":
			return {
				kind: "notice",
				message: copy.errors.limited,
				retryAfter: error.retryAfter,
			};
		case "timeout":
		case "network_error":
			return { kind: "notice", message: copy.errors.network };
		default:
			return { kind: "notice", message: copy.errors.failed };
	}
}
