import {
	createMiddleware,
	createServerOnlyFn,
	getGlobalStartContext,
} from "@tanstack/react-start";
import type { Studio } from "@tattoo-drip/sdk";
import { storefrontConfig } from "./config.ts";
import { handleTenantRequest } from "./handle.ts";

/**
 * Every server request's studio, from its Host (TAT-12). A studio goes on as
 * the request context's `studio` (`serverContext.studio` in server-side
 * loaders and beforeLoad); the landing page, the 404 page, an old slug's
 * redirect and the API-down page are answered here, before any route runs.
 */
export const tenantMiddleware = createMiddleware().server(
	async ({ request, next }) => {
		const outcome = await handleTenantRequest(request, {
			config: storefrontConfig(),
		});
		if (outcome.type === "respond") return outcome.response;
		return next({ context: { studio: outcome.studio } });
	},
);

/**
 * This request's studio, on the server only: in getRouter(), loaders and
 * server functions. TAT-23 builds its per-request SDK client from it.
 */
export const requestStudio = createServerOnlyFn((): Studio => {
	const context = getGlobalStartContext();
	if (!context) throw new Error("requestStudio() runs on the server only");
	return context.studio;
});
