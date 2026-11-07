import type { QueryClient } from "@tanstack/react-query";
import { createDiscoverClient, type DiscoverClient } from "@tattoo-drip/sdk";
import type { PublicSettings } from "./config.ts";
import { readOrigin } from "./origin.ts";
import {
	createDiscoverQueryClient,
	type QueryEnvironment,
} from "./query-client.ts";

/** How long a server-side read waits for the API. */
export const SERVER_TIMEOUT_MS = 5_000;

const NOT_CONNECTED =
	"Discover's context is not connected yet: getRouter() connects it on the server, the router's hydrate in the browser.";
const INVALID = "This page's settings are missing or invalid. Reload the page.";

/**
 * One router's connection to the platform (D05): the public settings and the
 * Discover SDK client, set once (on the server from process.env, in the
 * browser from the dehydrated state). Private fields, so serialising the
 * ref by mistake shows nothing.
 */
export class DiscoverRef {
	#settings: PublicSettings | undefined;
	#client: DiscoverClient | undefined;

	connect(settings: PublicSettings, client: DiscoverClient): void {
		if (this.#client)
			throw new Error("Discover's context is already connected.");
		this.#settings = settings;
		this.#client = client;
	}

	get settings(): PublicSettings {
		if (!this.#settings) throw new Error(NOT_CONNECTED);
		return this.#settings;
	}

	get client(): DiscoverClient {
		if (!this.#client) throw new Error(NOT_CONNECTED);
		return this.#client;
	}
}

/**
 * The router context: one QueryClient and one Discover client per server
 * request, and one of each per browser tab. Loaders read
 * `context.discover.client`; nothing here goes into loader data.
 */
export interface DiscoverContext {
	readonly queryClient: QueryClient;
	readonly discover: DiscoverRef;
}

export function createContext(environment: QueryEnvironment): DiscoverContext {
	return {
		queryClient: createDiscoverQueryClient(environment),
		discover: new DiscoverRef(),
	};
}

/** Connects a server render: the API from the settings, with a timeout. */
export function connectServer(
	context: DiscoverContext,
	settings: PublicSettings,
	options: { fetch?: typeof fetch } = {},
): void {
	context.discover.connect(
		settings,
		createDiscoverClient({
			baseUrl: settings.apiUrl,
			timeoutMs: SERVER_TIMEOUT_MS,
			fetch: options.fetch,
		}),
	);
}

/** What the router's dehydrated state carries: the public settings only. */
export interface Dehydrated {
	settings: PublicSettings;
}

export function dehydrateContext(context: DiscoverContext): Dehydrated {
	return { settings: context.discover.settings };
}

/**
 * The router's hydrate: connects the browser's client from the settings the
 * server sent, after checking their shape (the page's own state is not
 * trusted blindly). No key: the SDK never sends cookies.
 */
export function hydrateContext(
	context: DiscoverContext,
	dehydrated: { settings?: unknown } | undefined,
	options: { fetch?: typeof fetch } = {},
): void {
	const settings = parseSettings(dehydrated?.settings);
	context.discover.connect(
		settings,
		createDiscoverClient({ baseUrl: settings.apiUrl, fetch: options.fetch }),
	);
}

export function parseSettings(value: unknown): PublicSettings {
	if (typeof value !== "object" || value === null) throw new Error(INVALID);
	const raw = value as Record<string, unknown>;
	const origins = ["apiUrl", "mediaUrl", "siteUrl", "studioOsUrl"] as const;
	const read = Object.fromEntries(
		origins.map((key) => {
			const origin =
				typeof raw[key] === "string" ? readOrigin(raw[key] as string) : null;
			if (!origin) throw new Error(INVALID);
			return [key, origin];
		}),
	) as Record<(typeof origins)[number], string>;
	if (typeof raw.indexing !== "boolean") throw new Error(INVALID);
	return { ...read, indexing: raw.indexing };
}
