/**
 * Reviews and Fresh ink's refusals. Messages are for developers unless a
 * comment says otherwise; the API and the dashboard word their own.
 */

/** Why a review link can't be made for a project now. */
export type ReviewLinkRuleReason = "disabled" | "not_done";

/**
 * A review link asked for while reviews are off (the feature flag), or for
 * a project whose tattoo work isn't done (ruling 3: in progress, in its
 * healing check or completed, with a completed tattoo session).
 */
export class ReviewLinkRuleError extends Error {
	constructor(readonly reason: ReviewLinkRuleReason) {
		super(`A review link can't be made: ${reason}`);
	}
}

/**
 * Every review link that doesn't work: unknown, revoked, expired, another
 * studio's, made with an earlier APP_KEY, or its project, client or tattoo
 * session gone. The public API's one 404.
 */
export class ReviewPageNotFoundError extends Error {
	constructor() {
		super("No review page for this link");
	}
}

/**
 * The client asked to change what they may no longer change: a review or a
 * post TattooDrip took down, or the content of a post the studio declined
 * or unpublished (ruling 7). Its delete, its consents and its name still work.
 */
export class ReviewLockedError extends Error {
	constructor() {
		super("This review or post can't be changed now");
	}
}

/** A ninth photo or video for a post (ruling 5: a lead and up to seven more). */
export class PostFullError extends Error {
	constructor() {
		super("This post already has its photos and videos");
	}
}

/**
 * A video that would lead a post: a video added before any photo, or the
 * last photo removed while videos stay (ruling 5: a video never leads).
 */
export class PostNeedsPhotoError extends Error {
	constructor() {
		super("A post needs a photo to lead it");
	}
}

/**
 * A video upload that can't be used: not this link's, expired, never
 * arrived, not the length that was signed, or added already. The message is
 * for the client.
 */
export class ClientVideoUploadError extends Error {
	constructor(message = "This upload can't be used. Choose the video again.") {
		super(message);
	}
}

/**
 * A submit the review page must correct: one field's words for the client
 * (the API's `validation_failed` with that field), for the checks that need
 * the studio's data (its style list, the post's items).
 */
export class ReviewInputError extends Error {
	constructor(
		readonly field: string,
		message: string,
	) {
		super(message);
	}
}
