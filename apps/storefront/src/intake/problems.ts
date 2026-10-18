import { isTattooApiError } from "@tattoo-drip/sdk";
import type { ChallengeFailure } from "./challenge.ts";
import { copy, fill, type NoticeCode } from "./copy.ts";
import { FIELD_ORDER, type FieldErrors, type IntakeField } from "./rules.ts";

/*
 * What the form says when a send doesn't go through (TAT-57, spec ruling
 * 11): an error on the field it is about, or a notice with fixed copy
 * (copy.notices) and the way on: send again, reload, or the studio's chat
 * links. Branches on the API's code, never its message; the only API words
 * shown are validation_failed's field messages.
 */

export type SubmitProblem =
	| {
			readonly kind: "fields";
			readonly fields: FieldErrors;
			/** The API's message per sent photo index (`referenceImages.<i>`). */
			readonly photos: Readonly<Record<number, string>>;
			/** The API's message about the photos as a whole (`referenceImages`). */
			readonly photosError: string | null;
	  }
	| {
			readonly kind: "notice";
			readonly code: NoticeCode;
			/** "Send again" can help. */
			readonly retry: boolean;
			/** Show the studio's chat links. */
			readonly contact: boolean;
			/** Offer to reload the page. */
			readonly reload: boolean;
			/** Block Send this long (rate_limited). */
			readonly waitSeconds: number | null;
	  };

export interface ProblemContext {
	/** The artist the attempt asked for, if any. */
	readonly sentArtistId: string | null;
	artistName(id: string): string | null;
}

/** How long a 429 without Retry-After blocks Send. */
export const DEFAULT_WAIT_SECONDS = 60;
/** The most of an API field message the form shows. */
const MAX_MESSAGE = 300;
const FIELDS = new Set<string>(FIELD_ORDER);
const PHOTO_KEY = /^referenceImages\.(\d+)$/;

type Flags = {
	retry?: boolean;
	contact?: boolean;
	reload?: boolean;
	waitSeconds?: number;
};

function notice(code: NoticeCode, flags: Flags = {}): SubmitProblem {
	return {
		kind: "notice",
		code,
		retry: flags.retry ?? false,
		contact: flags.contact ?? false,
		reload: flags.reload ?? false,
		waitSeconds: flags.waitSeconds ?? null,
	};
}

export function describeSubmitError(
	error: unknown,
	context: ProblemContext,
): SubmitProblem {
	if (!isTattooApiError(error)) {
		return notice("server", { retry: true, contact: true });
	}
	const { retryAfter } = error;
	const rateLimited = () =>
		notice("rate-limited", {
			contact: true,
			waitSeconds: retryAfter ?? DEFAULT_WAIT_SECONDS,
		});
	switch (error.code) {
		case "validation_failed":
			return fieldProblem(error.fields);
		case "artist_not_accepting": {
			const name = context.sentArtistId
				? context.artistName(context.sentArtistId)
				: null;
			return {
				kind: "fields",
				fields: {
					preferredArtistId: name
						? fill(copy.errors.artistClosed, { artist: name })
						: copy.errors.artistClosedUnnamed,
				},
				photos: {},
				photosError: null,
			};
		}
		case "too_many_open_inquiries":
			return notice("already-waiting", { contact: true });
		case "studio_not_accepting":
			return notice("studio-closed", { contact: true });
		case "challenge_failed":
			return notice("challenge-failed", { retry: true, contact: true });
		case "challenge_unavailable":
			return notice("challenge-unavailable", { retry: true, contact: true });
		case "rate_limited":
			return rateLimited();
		case "payload_too_large":
			return notice("too-large");
		case "bad_request":
			return notice("cut-off", { retry: true });
		case "not_found":
			return notice("page-outdated", { reload: true });
		case "timeout":
			return notice("timeout", { retry: true });
		case "network_error":
			return notice("offline", { retry: true });
	}
	// A response without the API's envelope (a proxy's 413 or 429).
	if (error.status === 413) return notice("too-large");
	if (error.status === 429) return rateLimited();
	return notice("server", { retry: true, contact: true });
}

/** What the form says when something it didn't expect threw: try again, or message the studio. */
export function unexpectedProblem(): Extract<
	SubmitProblem,
	{ kind: "notice" }
> {
	return {
		kind: "notice",
		code: "server",
		retry: true,
		contact: true,
		reload: false,
		waitSeconds: null,
	};
}

export function describeChallengeFailure(
	reason: ChallengeFailure,
): SubmitProblem {
	switch (reason) {
		case "blocked":
			return notice("challenge-blocked", { retry: true, contact: true });
		case "expired":
			return notice("challenge-expired", { retry: true });
		case "unsupported":
			return notice("challenge-unsupported", { contact: true });
	}
}

function fieldProblem(apiFields: unknown): SubmitProblem {
	const fields: FieldErrors = {};
	const photos: Record<number, string> = {};
	let photosError: string | null = null;
	const entries =
		typeof apiFields === "object" && apiFields !== null
			? Object.entries(apiFields)
			: [];
	for (const [key, value] of entries) {
		const message = firstMessage(value);
		if (!message) continue;
		const photo = PHOTO_KEY.exec(key);
		if (FIELDS.has(key)) {
			fields[key as IntakeField] ??= message;
		} else if (key === "referenceImages") {
			photosError ??= message;
		} else if (photo) {
			photos[Number(photo[1])] ??= fill(copy.photos.refused, { message });
		}
	}
	const placed =
		Object.keys(fields).length > 0 ||
		Object.keys(photos).length > 0 ||
		photosError !== null;
	return placed
		? { kind: "fields", fields, photos, photosError }
		: notice("invalid");
}

/** A field's first message as text: the contract says a list, but a lone string counts and anything else is ignored. */
function firstMessage(value: unknown): string | undefined {
	const messages: readonly unknown[] = Array.isArray(value) ? value : [value];
	const text = messages.find(
		(each): each is string => typeof each === "string" && each.trim() !== "",
	);
	return text?.trim().slice(0, MAX_MESSAGE);
}

/** "a minute", "20 minutes", "an hour", "24 hours": rounded up. */
export function formatWait(seconds: number): string {
	const minutes = Math.ceil(seconds / 60);
	if (minutes <= 1) return copy.wait.minute;
	if (minutes < 60) return fill(copy.wait.minutes, { count: minutes });
	const hours = Math.ceil(seconds / 3600);
	return hours <= 1 ? copy.wait.hour : fill(copy.wait.hours, { count: hours });
}

/** The values a notice's copy fills in. */
export function noticeValues(
	problem: Extract<SubmitProblem, { kind: "notice" }>,
	studioName: string,
): { studio: string; wait: string } {
	return {
		studio: studioName,
		wait: formatWait(problem.waitSeconds ?? DEFAULT_WAIT_SECONDS),
	};
}
