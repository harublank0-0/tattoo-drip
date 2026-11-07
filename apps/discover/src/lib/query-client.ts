import {
	defaultShouldDehydrateQuery,
	type Query,
	QueryClient,
} from "@tanstack/react-query";
import { isTattooApiError } from "@tattoo-drip/sdk";

/**
 * How long public Discover data counts as fresh: the API's own max-age
 * (60 s, docs/discover/api.md), so a query the server rendered isn't
 * fetched again when the page mounts in the browser.
 */
export const STALE_TIME_MS = 60_000;

/** Retries after a first failed read, in the browser only. */
export const MAX_RETRIES = 2;

export type QueryEnvironment = "server" | "browser";

/**
 * Retry only when asking again can help: a timeout, a network error or a
 * 5xx. Never a 4xx (a 404 is an answer), never a cancellation or a bug.
 */
export function shouldRetry(failureCount: number, error: unknown): boolean {
	if (!isTattooApiError(error)) return false;
	const transient = error.status === 0 || error.status >= 500;
	return transient && failureCount < MAX_RETRIES;
}

/**
 * What a server render sends the browser: successful queries and pending
 * ones (streamed when they settle). A failed read stays on the server and
 * the browser asks again.
 */
export function shouldDehydrateQuery(query: Query): boolean {
	return defaultShouldDehydrateQuery(query) || query.state.status === "pending";
}

/**
 * A new QueryClient for one server request or one browser tab, never
 * shared: getRouter() makes one per router, so no request can read another
 * request's cache. A server render never retries (a slow API would hold the
 * page), the browser retries transient failures.
 */
export function createDiscoverQueryClient(
	environment: QueryEnvironment,
): QueryClient {
	return new QueryClient({
		defaultOptions: {
			queries: {
				staleTime: STALE_TIME_MS,
				retry: environment === "browser" ? shouldRetry : false,
				refetchOnWindowFocus: false,
			},
			dehydrate: { shouldDehydrateQuery },
		},
	});
}
