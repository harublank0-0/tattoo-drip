import { createIsomorphicFn } from "@tanstack/react-start";
import { storefrontConfig } from "../tenancy/config.ts";
import { requestStudio } from "../tenancy/middleware.ts";
import {
	type ApiContext,
	connectServer,
	createApiContext,
	seedStudio,
} from "./context.ts";

/**
 * A new router's API state (TAT-23). On the server: a client for the studio
 * the tenant middleware confirmed (TAT-12), with the server key when set,
 * and that studio already cached. In the browser: unconnected until the
 * router hydrates (hydrateApi). Start strips the server part, and with it
 * the settings and the key, from the browser bundle.
 */
export const createRequestApi = createIsomorphicFn()
	.server((): ApiContext => {
		const studio = requestStudio();
		const api = createApiContext("server");
		connectServer(api, { config: storefrontConfig(), studio });
		seedStudio(api, studio);
		return api;
	})
	.client((): ApiContext => createApiContext("browser"));
