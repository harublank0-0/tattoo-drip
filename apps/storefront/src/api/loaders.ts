import { notFound } from "@tanstack/react-router";
import { tattooQueries } from "@tattoo-drip/react";
import { isTattooApiError, type Studio } from "@tattoo-drip/sdk";
import type { ApiContext } from "./context.ts";

/**
 * For a loader's catch: the API's own 404 (a studio or record that no longer
 * exists) becomes the router's not-found, so the route's notFoundComponent
 * shows; anything else is rethrown as it is, for the error component.
 */
export function rethrowAsNotFound(error: unknown): never {
	if (
		isTattooApiError(error) &&
		error.status === 404 &&
		error.code === "not_found"
	) {
		throw notFound();
	}
	throw error;
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
		return rethrowAsNotFound(error);
	}
}
