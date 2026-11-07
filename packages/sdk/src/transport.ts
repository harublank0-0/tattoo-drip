import type { ApiError } from "@tattoo-drip/types";
import { TattooApiError } from "./errors.js";

/**
 * The HTTP layer every client shares (the studio client, the Discover
 * client): one API version, JSON in `{ data }` / `{ error }` envelopes,
 * no cookies, a timeout and the caller's cancellation, typed errors.
 * Internal: the package exports the clients, not this.
 */
export const API_VERSION = "v1";
export const DEFAULT_TIMEOUT_MS = 10_000;

/** Options for one call. */
export interface RequestOptions {
	/** Cancels the call; it then rejects with the signal's reason (an `AbortError`). */
	signal?: AbortSignal;
	/**
	 * Milliseconds before this call gives up with `timeout`, instead of the
	 * client's `timeoutMs` (or the 2 minutes an upload gets).
	 */
	timeoutMs?: number;
}

export type Query = Record<string, string | number | boolean | undefined>;
type ResponseBody = { data?: unknown; error?: Partial<ApiError> };

export interface TransportOptions {
	baseUrl: string;
	key?: string;
	fetch?: typeof fetch;
	timeoutMs?: number;
}

/** The API root and the request functions for one client's options. */
export function createTransport(options: TransportOptions) {
	if (options.key && "document" in globalThis) {
		throw new Error(
			"@tattoo-drip/sdk: secret keys must never be used in a browser.",
		);
	}

	const fetchImpl = options.fetch ?? globalThis.fetch;
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const apiRoot = `${options.baseUrl.replace(/\/+$/, "")}/api/${API_VERSION}`;

	async function request<T>(
		url: string,
		init: RequestInit = {},
		call: RequestOptions = {},
	): Promise<T> {
		const { signal } = call;
		const headers = new Headers(init.headers);
		headers.set("Accept", "application/json");
		if (options.key) headers.set("Authorization", `Bearer ${options.key}`);

		const timeout = AbortSignal.timeout(call.timeoutMs ?? timeoutMs);
		let response: Response;
		let body: ResponseBody | undefined;
		try {
			response = await fetchImpl(url, {
				...init,
				headers,
				// The API is stateless and cookieless: never send cookies to it.
				credentials: "omit",
				signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
			});
			body = await readJson(response);
		} catch (error) {
			// The caller cancelled: let its AbortError through (TanStack Query
			// expects it).
			if (signal?.aborted) throw signal.reason;
			if (timeout.aborted) {
				throw new TattooApiError(0, {
					code: "timeout",
					message: "The Tattoo Drip API did not answer in time.",
				});
			}
			throw new TattooApiError(
				0,
				{
					code: "network_error",
					message: "The Tattoo Drip API could not be reached.",
				},
				{ cause: error },
			);
		}

		if (!response.ok) {
			throw new TattooApiError(response.status, body?.error, {
				retryAfter: retryAfterOf(response),
			});
		}
		if (!body || !("data" in body)) {
			throw new TattooApiError(response.status, {
				code: "invalid_response",
				message: "The API returned an unexpected response body.",
			});
		}
		return body as T;
	}

	async function getData<T>(url: string, call?: RequestOptions): Promise<T> {
		return (await request<{ data: T }>(url, {}, call)).data;
	}

	return { apiRoot, request, getData };
}

export function withQuery(url: string, query?: Query): string {
	if (!query) return url;
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(query)) {
		if (value !== undefined) params.set(key, String(value));
	}
	const search = params.toString();
	return search ? `${url}?${search}` : url;
}

/**
 * The JSON body, or undefined when there is none, it isn't JSON or it isn't an
 * object (a bare string, number, boolean, null or array is no envelope, and
 * `"data" in body` would throw on it). Reading the body can still fail (a
 * timeout or a dropped connection): that throws.
 */
async function readJson(response: Response): Promise<ResponseBody | undefined> {
	if (!response.headers.get("content-type")?.includes("json")) return undefined;
	const text = await response.text();
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return undefined;
	}
	return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
		? (parsed as ResponseBody)
		: undefined;
}

/** `Retry-After` in seconds, when the API sent it as a number. */
function retryAfterOf(response: Response): number | undefined {
	const seconds = Number.parseInt(
		response.headers.get("retry-after") ?? "",
		10,
	);
	return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}
