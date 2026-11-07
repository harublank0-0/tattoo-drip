import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { discoverConfig, publicSettings } from "./config.ts";
import {
	connectServer,
	createContext,
	type DiscoverContext,
} from "./context.ts";
import { requestPreference } from "./country.ts";

/**
 * A new router's context. On the server: connected from process.env and
 * this request's country preference (its `td_country` cookie and, when
 * DISCOVER_GEO_HEADER is set, the trusted proxy's header; Start strips this
 * branch, and the settings with it, from the browser bundle). In the
 * browser: connected by the router's hydrate.
 */
export const createRequestContext = createIsomorphicFn()
	.server((): DiscoverContext => {
		const config = discoverConfig();
		const context = createContext("server");
		connectServer(
			context,
			publicSettings(config),
			requestPreference(getRequest().headers, config),
		);
		return context;
	})
	.client((): DiscoverContext => createContext("browser"));
