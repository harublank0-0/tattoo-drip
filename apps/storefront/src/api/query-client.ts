import {
	defaultShouldDehydrateQuery,
	type Query,
	QueryClient,
} from "@tanstack/react-query";
import { isTattooApiError } from "@tattoo-drip/sdk";

/**
 * How long fetched data counts as fresh: the API's own max-age (TAT-32), so
 * a query hydrated from the server isn't fetched again when its page mounts.
 */
export const STALE_TIME_MS = 60_000;

/** Retries after a first failed read, in the browser only. */
export const MAX_RETRIES = 2;

/** A Retry-After longer than this (seconds) isn't waited for: the error shows. */
export const MAX_RETRY_AFTER_SECONDS = 10;

export type QueryEnvironment = "server" | "browser";

/**
 * Retry a read only when asking again can help: a timeout, a network error
 * or a 5xx (twice), a 429 once after its Retry-After. Never a 4xx, never a
 * long Retry-After, never something that isn't an API error (a bug or a
 * cancellation).
 */
export function shouldRetry(failureCount: number, error: unknown): boolean {
	if (!isTattooApiError(error)) return false;
	if (
		error.retryAfter !== undefined &&
		error.retryAfter > MAX_RETRY_AFTER_SECONDS
	) {
		return false;
	}
	if (error.status === 429) {
		return error.retryAfter !== undefined && failureCount < 1;
	}
	const transient = error.status === 0 || error.status >= 500;
	return transient && failureCount < MAX_RETRIES;
}

/** The API's Retry-After when it sent one, else 1 s, 2 s, … at most 8 s. */
export function retryDelay(failureCount: number, error: unknown): number {
	if (isTattooApiError(error) && error.retryAfter !== undefined) {
		return error.retryAfter * 1000;
	}
	return Math.min(1000 * 2 ** failureCount, 8000);
}

/**
 * What a server render sends the browser: successful queries, and pending
 * ones (streamed when they settle; a rejection arrives redacted). A failed
 * read stays on the server and the browser asks again.
 */
export function shouldDehydrateQuery(query: Query): boolean {
	return defaultShouldDehydrateQuery(query) || query.state.status === "pending";
}

/**
 * A QueryClient for one server request or one browser tab (TAT-23). The
 * server never retries: a page shouldn't wait seconds, and TAT-12's 503 page
 * covers an API that is down.
 */
export function createStorefrontQueryClient(
	environment: QueryEnvironment,
): QueryClient {
	return new QueryClient({
		defaultOptions: {
			queries: {
				staleTime: STALE_TIME_MS,
				retry: environment === "server" ? false : shouldRetry,
				retryDelay,
			},
			dehydrate: { shouldDehydrateQuery, shouldRedactErrors: () => true },
		},
	});
}
