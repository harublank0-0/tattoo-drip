import { type DepositPage, isTattooApiError } from "@tattoo-drip/sdk";
import { fill } from "../intake/copy.ts";
import { copy, type ProofNoticeCode } from "./copy.ts";

/*
 * What the deposit page says when a read or a send doesn't go through
 * (TAT-65b, spec ruling 17 and its table). Branches on the API's code and
 * status, never its message; the only API words shown are
 * validation_failed's field messages, as text.
 */

export type LoadProblem = "dead" | "rate-limited" | "failed";

/** A 404, with or without the API's envelope: this link doesn't work (TAT-65 ruling 4). */
export function isGone(error: unknown): boolean {
	return isTattooApiError(error) && error.status === 404;
}

export function describeLoadError(error: unknown): LoadProblem {
	if (isGone(error)) return "dead";
	if (isTattooApiError(error) && error.status === 429) return "rate-limited";
	return "failed";
}

export type Screen =
	| { readonly kind: "loading" }
	| { readonly kind: "problem"; readonly problem: LoadProblem }
	| { readonly kind: "page"; readonly page: DepositPage };

/**
 * What the screen shows for the query's state. A 404 wins over data already
 * shown (a replaced or expired link must stop showing payment details); any
 * other failed refresh keeps the data.
 */
export function screenFor(query: {
	readonly data: DepositPage | undefined;
	readonly error: unknown;
}): Screen {
	if (query.error && isGone(query.error)) {
		return { kind: "problem", problem: "dead" };
	}
	if (query.data) return { kind: "page", page: query.data };
	if (query.error) {
		return { kind: "problem", problem: describeLoadError(query.error) };
	}
	return { kind: "loading" };
}

export type ProofProblem =
	| {
			readonly kind: "fields";
			readonly fields: { readonly proof?: string; readonly method?: string };
	  }
	| {
			readonly kind: "notice";
			readonly code: ProofNoticeCode;
			/** Read the page again: it may have changed, or the upload may have landed. */
			readonly refetch: boolean;
			/** Block Send this long (a rate limit). */
			readonly waitSeconds: number | null;
	  };

/** How long a 429 without Retry-After blocks Send. */
export const DEFAULT_WAIT_SECONDS = 60;
/** The most of an API field message the page shows. */
const MAX_MESSAGE = 300;

function notice(
	code: ProofNoticeCode,
	flags: { refetch?: boolean; waitSeconds?: number } = {},
): ProofProblem {
	return {
		kind: "notice",
		code,
		refetch: flags.refetch ?? false,
		waitSeconds: flags.waitSeconds ?? null,
	};
}

const TOO_LARGE: ProofProblem = {
	kind: "fields",
	fields: { proof: copy.form.tooLarge },
};

export function describeProofError(error: unknown): ProofProblem {
	if (!isTattooApiError(error)) return notice("server");
	const wait = error.retryAfter ?? DEFAULT_WAIT_SECONDS;
	switch (error.code) {
		case "validation_failed":
			return fieldProblem(error.fields);
		case "deposit_changed":
			return notice("changed", { refetch: true });
		case "deposit_not_due":
			return notice("not-due", { refetch: true });
		case "not_found":
			return notice("gone", { refetch: true });
		case "payload_too_large":
			return TOO_LARGE;
		case "rate_limited":
			return notice("rate-limited", { waitSeconds: wait });
		case "bad_request":
		case "unsupported_media_type":
			return notice("cut-off");
		case "request_timeout":
		case "timeout":
		case "network_error":
			return notice("offline", { refetch: true });
		case "service_busy":
			return notice("busy");
	}
	// A response without the API's envelope (a proxy's 404, 409, 413 or 429).
	if (error.status === 404) return notice("gone", { refetch: true });
	if (error.status === 409) return notice("not-due", { refetch: true });
	if (error.status === 413) return TOO_LARGE;
	if (error.status === 429)
		return notice("rate-limited", { waitSeconds: wait });
	return notice("server");
}

function fieldProblem(
	apiFields: Readonly<Record<string, unknown>>,
): ProofProblem {
	const proof = firstMessage(apiFields.proof);
	const method = firstMessage(apiFields.method);
	if (proof || method) {
		return {
			kind: "fields",
			fields: { ...(proof ? { proof } : {}), ...(method ? { method } : {}) },
		};
	}
	// The page's amount is stale: TAT-65's deposit_changed in all but name.
	if (firstMessage(apiFields.expectedAmount)) {
		return notice("changed", { refetch: true });
	}
	return notice("invalid");
}

/**
 * A field's first message as text, at most 300 characters: the API's list
 * (a lone string counts), or the form's errors (strings or `{ message }`).
 */
export function firstMessage(value: unknown): string | undefined {
	const list: readonly unknown[] = Array.isArray(value) ? value : [value];
	for (const each of list) {
		const text =
			typeof each === "string"
				? each
				: typeof each === "object" &&
						each !== null &&
						"message" in each &&
						typeof each.message === "string"
					? each.message
					: undefined;
		if (text?.trim()) return text.trim().slice(0, MAX_MESSAGE);
	}
	return undefined;
}

/** "a minute", "20 minutes", "an hour", "24 hours": rounded up (TAT-57's rule). */
export function formatWait(seconds: number): string {
	const minutes = Math.ceil(seconds / 60);
	if (minutes <= 1) return copy.wait.minute;
	if (minutes < 60) return fill(copy.wait.minutes, { count: minutes });
	const hours = Math.ceil(seconds / 3600);
	return hours <= 1 ? copy.wait.hour : fill(copy.wait.hours, { count: hours });
}

/** The form's own rule: a method the page lists. The screenshot is checked apart (it isn't a form value). */
export function validateProofForm(
	values: { readonly method: string },
	kinds: readonly string[],
): { method: string } | null {
	return kinds.includes(values.method)
		? null
		: { method: copy.form.required.method };
}

/** One line of the error summary: the control it focuses, the field's name, the message. */
export interface SummaryItem {
	readonly target: "method-0" | "proof-input";
	readonly label: string;
	readonly message: string;
}

export function summaryItems(
	method: string | undefined,
	proof: string | null,
): SummaryItem[] {
	const items: SummaryItem[] = [];
	if (method) {
		items.push({
			target: "method-0",
			label: copy.form.summaryLabels.method,
			message: method,
		});
	}
	if (proof) {
		items.push({
			target: "proof-input",
			label: copy.form.summaryLabels.proof,
			message: proof,
		});
	}
	return items;
}
