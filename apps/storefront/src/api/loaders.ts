import { notFound } from "@tanstack/react-router";
import { tattooQueries } from "@tattoo-drip/react";
import { isTattooApiError, type Studio } from "@tattoo-drip/sdk";
import type { ApiContext } from "./context.ts";

/**
 * For a loader's catch: the API's own 404 (a studio or record that no longer
 * exists) becomes the router's not-found, so the route's notFoundComponent
 * shows; anything else is the error component's, as a PageReadError (Prompt
 * 8): the router serializes a failed match's error into the page's state for
 * the browser, so it must carry nothing of the API's (its message, the URL,
 * a stack). The log line says which studio and what failed: the API's status
 * and code (never its message), or a bug's name and stack.
 */
export function rethrowAsNotFound(error: unknown, slug?: string): never {
	if (
		isTattooApiError(error) &&
		error.status === 404 &&
		error.code === "not_found"
	) {
		throw notFound();
	}
	// Like the other read lines: the studio, the API's status and code, never
	// its message; a failure that is not the API's (a bug, a parse error, an
	// abort) keeps its name and stack, which are this code's, for the log.
	console.error(
		"Page read failed",
		isTattooApiError(error)
			? { slug, status: error.status, code: error.code }
			: {
					slug,
					error: error instanceof Error ? error.name : typeof error,
					stack: error instanceof Error ? error.stack : undefined,
				},
	);
	throw new PageReadError();
}

/** A read the page could not do, as the browser may see it: one fixed sentence, nothing of the cause. */
export class PageReadError extends Error {
	constructor() {
		super("The page could not be loaded.");
		this.name = "PageReadError";
	}
}

/**
 * The root route's loader: the studio, from the cache when it has it (on the
 * server the tenant middleware's answer is already there), else from the
 * API. `query()` with staleTime "static" is cached data, else one fetch:
 * TanStack Query 5.104's replacement for the deprecated ensureQueryData.
 */
export async function loadStudio({
	queryClient,
	tattoo,
}: ApiContext): Promise<Studio> {
	try {
		return await queryClient.query({
			...tattooQueries.studio(tattoo.client),
			staleTime: "static",
		});
	} catch (error) {
		return rethrowAsNotFound(error, tattoo.connection.tenant);
	}
}
