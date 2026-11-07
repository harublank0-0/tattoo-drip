import { createIsomorphicFn } from "@tanstack/react-start";
import { discoverConfig, publicSettings } from "./config.ts";
import {
	connectServer,
	createContext,
	type DiscoverContext,
} from "./context.ts";

/**
 * A new router's context. On the server: connected from process.env (Start
 * strips this branch, and the settings with it, from the browser bundle).
 * In the browser: connected by the router's hydrate.
 */
export const createRequestContext = createIsomorphicFn()
	.server((): DiscoverContext => {
		const context = createContext("server");
		connectServer(context, publicSettings(discoverConfig()));
		return context;
	})
	.client((): DiscoverContext => createContext("browser"));
