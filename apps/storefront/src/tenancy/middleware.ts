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
		return next({
			context: {
				studio: outcome.studio,
				visitorAddress: outcome.visitorAddress,
			},
		});
	},
);

/**
 * This request's studio, on the server only: in getRouter(), loaders and
 * server functions. TAT-23 builds its per-request SDK client from it.
 */
export const requestStudio = createServerOnlyFn((): Studio => {
	// On the server Start's own getGlobalStartContext() throws when the
	// middleware has not run yet; its `undefined` is the browser stub, and
	// createServerOnlyFn throws in the browser before this body.
	const context = getGlobalStartContext() as NonNullable<
		ReturnType<typeof getGlobalStartContext>
	>;
	return context.studio;
});

/**
 * This request's visitor address, on the server only: TAT-23's per-request
 * client sends it with the key (TAT-38). Undefined without a key.
 */
export const requestVisitorAddress = createServerOnlyFn(
	(): string | undefined => {
		const context = getGlobalStartContext() as NonNullable<
			ReturnType<typeof getGlobalStartContext>
		>;
		return context.visitorAddress;
	},
);
