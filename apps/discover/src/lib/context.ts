import type { QueryClient } from "@tanstack/react-query";
import { createDiscoverClient, type DiscoverClient } from "@tattoo-drip/sdk";
import type { PublicSettings } from "./config.ts";
import { type CountryPreference, normalizeCountry } from "./country.ts";
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
 * The visitor's country preference (D06.5): resolved once per server
 * request (cookie, trusted geolocation header, default), sent to the
 * browser with the settings, and changed in the browser's tab when the
 * visitor switches country. A page's own `?country=` is applied on top by
 * the root route (`pageCountry`). Per router, never module state.
 */
export class CountryPreferenceRef {
	#value: CountryPreference | undefined;

	get current(): CountryPreference {
		if (!this.#value) throw new Error(NOT_CONNECTED);
		return this.#value;
	}

	set(value: CountryPreference): void {
		this.#value = value;
	}
}

/**
 * The router context: one QueryClient and one Discover client per server
 * request, and one of each per browser tab. Loaders read
 * `context.discover.client`; nothing here goes into loader data. The root
 * route adds `country` (this page's resolved country) for every route.
 */
export interface DiscoverContext {
	readonly queryClient: QueryClient;
	readonly discover: DiscoverRef;
	readonly preference: CountryPreferenceRef;
}

export function createContext(environment: QueryEnvironment): DiscoverContext {
	return {
		queryClient: createDiscoverQueryClient(environment),
		discover: new DiscoverRef(),
		preference: new CountryPreferenceRef(),
	};
}

/**
 * Connects a server render: the API from the settings, with a timeout, and
 * this request's country preference.
 */
export function connectServer(
	context: DiscoverContext,
	settings: PublicSettings,
	preference: CountryPreference,
	options: { fetch?: typeof fetch } = {},
): void {
	context.preference.set(parsePreference(preference, settings));
	context.discover.connect(
		settings,
		createDiscoverClient({
			baseUrl: settings.apiUrl,
			timeoutMs: SERVER_TIMEOUT_MS,
			fetch: options.fetch,
		}),
	);
}

/** What the router's dehydrated state carries: the public settings and the request's country preference. */
export interface Dehydrated {
	settings: PublicSettings;
	country: CountryPreference;
}

export function dehydrateContext(context: DiscoverContext): Dehydrated {
	return {
		settings: context.discover.settings,
		country: context.preference.current,
	};
}

/**
 * The router's hydrate: connects the browser's client from the settings the
 * server sent, after checking their shape (the page's own state is not
 * trusted blindly). No key: the SDK never sends cookies.
 */
export function hydrateContext(
	context: DiscoverContext,
	dehydrated: { settings?: unknown; country?: unknown } | undefined,
	options: { fetch?: typeof fetch } = {},
): void {
	const settings = parseSettings(dehydrated?.settings);
	context.preference.set(parsePreference(dehydrated?.country, settings));
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
	if (!Array.isArray(raw.markets) || raw.markets.length === 0)
		throw new Error(INVALID);
	const markets = raw.markets.map((code) => {
		const country = normalizeCountry(code);
		if (!country || country !== code) throw new Error(INVALID);
		return country;
	});
	const defaultCountry = normalizeCountry(raw.defaultCountry);
	if (!defaultCountry || !markets.includes(defaultCountry))
		throw new Error(INVALID);
	return { ...read, indexing: raw.indexing, markets, defaultCountry };
}

const PREFERENCE_SOURCES = new Set(["cookie", "geo", "fallback"]);

/**
 * A country preference, checked: an assigned code that is one of the
 * markets (only market codes are ever saved, believed or defaulted to), and
 * a known source.
 */
export function parsePreference(
	value: unknown,
	settings: Pick<PublicSettings, "markets">,
): CountryPreference {
	if (typeof value !== "object" || value === null) throw new Error(INVALID);
	const raw = value as Record<string, unknown>;
	const country = normalizeCountry(raw.country);
	if (
		!country ||
		!settings.markets.includes(country) ||
		typeof raw.source !== "string" ||
		!PREFERENCE_SOURCES.has(raw.source)
	)
		throw new Error(INVALID);
	return { country, source: raw.source as CountryPreference["source"] };
}
