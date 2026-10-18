import {
	createTattooClient,
	isTattooApiError,
	type Studio,
} from "@tattoo-drip/sdk";
import { STORED_SLUG } from "./host.ts";

/** How long a page waits for the API to confirm its studio (the SDK's default is 10 s). */
export const STUDIO_LOOKUP_TIMEOUT_MS = 5_000;

export type TenantLookup =
	| { type: "found"; studio: Studio }
	| { type: "moved"; slug: string }
	| { type: "missing" }
	| { type: "unavailable"; status: number; code: string };

export interface LookupOptions {
	/** The API's origin (API_URL). */
	apiUrl: string;
	/** Cancels the lookup with the request; its AbortError is rethrown. */
	signal?: AbortSignal;
	timeoutMs?: number;
	/** For tests. */
	fetch?: typeof fetch;
}

/**
 * Asks the API whether `slug` is a studio (getStudio, TAT-32). The API answers
 * an old slug like the current one and names the current slug in the body,
 * so a different slug there means the studio moved.
 */
export async function lookUpTenant(
	slug: string,
	options: LookupOptions,
): Promise<TenantLookup> {
	const client = createTattooClient({
		baseUrl: options.apiUrl,
		tenant: slug,
		fetch: options.fetch,
		timeoutMs: options.timeoutMs ?? STUDIO_LOOKUP_TIMEOUT_MS,
	});
	let studio: Studio;
	try {
		studio = await client.studio.get({ signal: options.signal });
	} catch (error) {
		if (!isTattooApiError(error)) {
			// The visitor left: their AbortError is not ours to hide.
			if (options.signal?.aborted) throw error;
			// Anything else is the API (or a server posing as it) misbehaving.
			// Never rethrown: the error's message can hold what the API sent,
			// and it must become the 503 page and one sanitized log line.
			return { type: "unavailable", status: 0, code: "invalid_response" };
		}
		// Only the API's own not_found is "no such studio": a bare 404 means
		// API_URL points at another server, which must not look like that.
		if (error.status === 404 && error.code === "not_found") {
			return { type: "missing" };
		}
		return {
			type: "unavailable",
			status: error.status,
			code: loggableCode(error.code),
		};
	}
	// The current slug goes into a redirect: it must have the stored shape.
	if (typeof studio?.slug !== "string" || !STORED_SLUG.test(studio.slug)) {
		return { type: "unavailable", status: 200, code: "invalid_slug" };
	}
	return studio.slug === slug
		? { type: "found", studio }
		: { type: "moved", slug: studio.slug };
}

/**
 * The API's error code, as it may be logged: a short lowercase token. The code
 * is the API's text (or a wrong server's), so anything else becomes
 * `unknown_error`, the SDK's own word for an error without one.
 */
function loggableCode(code: unknown): string {
	return typeof code === "string" && /^[a-z0-9_]{1,64}$/.test(code)
		? code
		: "unknown_error";
}
