import type { OrientationKey } from "#modules/design_lab/prompt";

/**
 * AI Design Lab's provider contract (docs/design-lab.md): the product flow
 * talks to this, never to a vendor, so another model or provider is one more
 * implementation. Generation is asynchronous: submit, then poll the handle
 * the provider returned, then download the finished image once.
 */

export type SubmitRequest = {
	prompt: string;
	orientation: OrientationKey;
	width: number;
	height: number;
	aspectRatio: string;
};

export type Submitted = {
	/** The provider's id for the request (safe to store and log). */
	requestId: string;
	/** Where to ask for the result, exactly as the provider gave it. Server only: sealed at rest. */
	pollingUrl: string;
	/** The provider's charge in its credits, when it reports one. */
	cost?: number;
};

export type PollResult =
	| { state: "pending"; providerStatus: string }
	| { state: "ready"; sampleUrl: string; seed?: number }
	| { state: "moderated"; code: "request_moderated" | "content_moderated" }
	| { state: "error"; providerStatus: string }
	| { state: "not_found" };

export interface DesignProvider {
	readonly name: string;
	readonly model: string;
	submit(request: SubmitRequest, signal?: AbortSignal): Promise<Submitted>;
	poll(pollingUrl: string, signal?: AbortSignal): Promise<PollResult>;
	/** The image bytes of a ready result. The URL is temporary: call promptly. */
	download(sampleUrl: string, signal?: AbortSignal): Promise<Buffer>;
}

/**
 * What went wrong talking to the provider, sorted by what the worker does:
 *
 * - `rate_limited`: too busy (HTTP 429); not accepted, try again later.
 * - `unavailable`: a server error or the network; for a submit with an HTTP
 *   answer it was not accepted; for a poll, poll again.
 * - `uncertain`: a submit whose outcome is unknown (timeout, cut connection,
 *   unreadable answer). Never resubmitted: it may have been charged.
 * - `credits`: the provider account has no credits left (HTTP 402).
 * - `auth`: the key was refused (401/403).
 * - `rejected`: the request was refused as invalid (400/422).
 * - `invalid_response`: an answer we must not use (a URL off the provider's
 *   domain, a non-image, too large).
 */
export type ProviderErrorKind =
	| "rate_limited"
	| "unavailable"
	| "uncertain"
	| "credits"
	| "auth"
	| "rejected"
	| "invalid_response";

export class DesignProviderError extends Error {
	constructor(
		readonly kind: ProviderErrorKind,
		message: string,
		readonly status?: number,
	) {
		super(message);
		this.name = "DesignProviderError";
	}
}
