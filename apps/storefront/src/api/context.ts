import type { QueryClient } from "@tanstack/react-query";
import { tattooKeys, tattooQueries } from "@tattoo-drip/react";
import {
	createTattooClient,
	type Studio,
	type TattooClient,
} from "@tattoo-drip/sdk";
import type { StorefrontConfig } from "../tenancy/config.ts";
import { STORED_SLUG } from "../tenancy/host.ts";
import {
	createStorefrontQueryClient,
	type QueryEnvironment,
} from "./query-client.ts";

/**
 * All the browser learns about the API (TAT-23): its origin and the studio's
 * current slug, the one the server confirmed from the Host header (TAT-12).
 */
export interface TattooConnection {
	readonly apiUrl: string;
	readonly tenant: string;
}

/** What the router's dehydrated state carries for the API. */
export interface DehydratedApi {
	tattoo: TattooConnection;
}

/**
 * The router context (TAT-23): one QueryClient and one SDK client per server
 * request, and one of each per browser tab. Loaders read
 * `context.tattoo.client`. Nothing here goes into loader data or a
 * beforeLoad result: the router serializes those into the page.
 */
export interface ApiContext {
	readonly queryClient: QueryClient;
	readonly tattoo: TattooClientRef;
}

/** How long a server-side read waits for the API, like TAT-12's lookup. */
export const SERVER_TIMEOUT_MS = 5_000;

const NOT_CONNECTED =
	"The Tattoo Drip client is not connected yet: getRouter() connects it on the server, the router's hydrate in the browser.";
const INVALID_CONNECTION =
	"This page's API connection is missing or invalid. Reload the page.";

/**
 * The router's SDK client, set once: in getRouter() on the server, in the
 * router's hydrate in the browser (before the first route matches). Private
 * fields, so serializing the ref shows nothing.
 */
export class TattooClientRef {
	#client: TattooClient | undefined;
	#connection: TattooConnection | undefined;

	connect(connection: TattooConnection, client: TattooClient): void {
		if (this.#client) {
			throw new Error("The Tattoo Drip client is already connected.");
		}
		if (client.tenant !== connection.tenant) {
			throw new Error("The client's tenant must be the connection's tenant.");
		}
		this.#connection = { apiUrl: connection.apiUrl, tenant: connection.tenant };
		this.#client = client;
	}

	get client(): TattooClient {
		if (!this.#client) throw new Error(NOT_CONNECTED);
		return this.#client;
	}

	get connection(): TattooConnection {
		if (!this.#connection) throw new Error(NOT_CONNECTED);
		return this.#connection;
	}
}

export function createApiContext(environment: QueryEnvironment): ApiContext {
	return {
		queryClient: createStorefrontQueryClient(environment),
		tattoo: new TattooClientRef(),
	};
}

export interface ServerConnectOptions {
	config: Pick<StorefrontConfig, "apiUrl" | "serverKey">;
	/** The studio the tenant middleware confirmed (TAT-12's requestStudio()). */
	studio: Studio;
	/** For tests. */
	fetch?: typeof fetch;
}

/**
 * Connects a server render's client: API_URL, the confirmed studio's slug,
 * and the server key when set (sent as Authorization: Bearer).
 */
export function connectServer(
	api: ApiContext,
	{ config, studio, fetch }: ServerConnectOptions,
): void {
	const client = createTattooClient({
		baseUrl: config.apiUrl,
		tenant: studio.slug,
		key: config.serverKey,
		timeoutMs: SERVER_TIMEOUT_MS,
		fetch,
	});
	api.tattoo.connect({ apiUrl: config.apiUrl, tenant: studio.slug }, client);
}

/**
 * Puts the tenant middleware's studio in the cache, so a render asks the API
 * for it once per page (the lookup), not twice.
 */
export function seedStudio(api: ApiContext, studio: Studio): void {
	api.queryClient.setQueryData(
		tattooQueries.studio(api.tattoo.client).queryKey,
		studio,
	);
}

/** The router's dehydrate: the connection, and nothing else. */
export function dehydrateApi(api: ApiContext): DehydratedApi {
	const { apiUrl, tenant } = api.tattoo.connection;
	return { tattoo: { apiUrl, tenant } };
}

/**
 * The router's hydrate: connects the browser's client from the connection
 * the server sent. No key; the SDK never sends cookies.
 *
 * Also keeps the studio in the cache for as long as the page lives. Every
 * page's root loader reads it, but nothing observes it, and a browser drops
 * an unobserved query after 5 minutes: the next navigation would fetch it
 * again, and a failure would replace the page with the root error. A query
 * takes its defaults when it is built, so this comes before the cache is
 * hydrated (a gcTime passed to the loader's query() would not reach a query
 * that already exists).
 */
export function hydrateApi(
	api: ApiContext,
	dehydrated: { tattoo?: unknown } | undefined,
	options: { fetch?: typeof fetch } = {},
): void {
	const connection = parseConnection(dehydrated?.tattoo);
	api.queryClient.setQueryDefaults(tattooKeys.studio(connection.tenant), {
		gcTime: Number.POSITIVE_INFINITY,
	});
	api.tattoo.connect(
		connection,
		createTattooClient({
			baseUrl: connection.apiUrl,
			tenant: connection.tenant,
			fetch: options.fetch,
		}),
	);
}

/** An http(s) origin and a stored-shape slug, or a fixed error. */
export function parseConnection(value: unknown): TattooConnection {
	if (typeof value !== "object" || value === null) {
		throw new Error(INVALID_CONNECTION);
	}
	const { apiUrl, tenant } = value as Record<string, unknown>;
	if (
		typeof apiUrl !== "string" ||
		!isOrigin(apiUrl) ||
		typeof tenant !== "string" ||
		!STORED_SLUG.test(tenant)
	) {
		throw new Error(INVALID_CONNECTION);
	}
	return { apiUrl, tenant };
}

function isOrigin(value: string): boolean {
	try {
		const url = new URL(value);
		return (
			(url.protocol === "https:" || url.protocol === "http:") &&
			url.origin === value
		);
	} catch {
		return false;
	}
}
