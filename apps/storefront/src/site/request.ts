import { createIsomorphicFn } from "@tanstack/react-start";
import { storefrontConfig, tenantOrigin } from "../tenancy/config.ts";
import { requestStudio } from "../tenancy/middleware.ts";
import { SiteRef } from "./context.ts";

/**
 * A new router's site: its origin (TAT-48) and the intake form's public site key (TAT-57). On the server: STOREFRONT_URL with
 * the slug the tenant middleware confirmed (TAT-12). In the browser: unset
 * until the router hydrates (hydrateSite). Start strips the server part,
 * and with it the settings, from the browser bundle.
 */
export const createRequestSite = createIsomorphicFn()
	.server((): SiteRef => {
		const config = storefrontConfig();
		const site = new SiteRef();
		site.connect(
			tenantOrigin(config, requestStudio().slug),
			config.challengeSiteKey ?? null,
		);
		return site;
	})
	.client((): SiteRef => new SiteRef());
