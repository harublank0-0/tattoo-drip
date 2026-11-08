/**
 * The server's fetch for API reads (D11): Discover's server key and its
 * visitor's address, sent with every
 * server-side API read so the API counts each visitor apart instead of all
 * of Discover as one client (the platform's DISCOVER_SERVER_KEYS and
 * VISITOR_IP_HEADER in #services/api_caller; Discover may not import the
 * platform). The key grants nothing else. Server only: the browser's reads
 * carry no key and are counted by the browser's own address.
 */
export const VISITOR_IP_HEADER = "x-visitor-ip";

const IPV4 =
	/^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
const IPV6 = /^[0-9A-Fa-f:.]{2,45}$/;

/** An IPv4 or IPv6 literal; the API checks the rest (one value, public). */
function isIpLiteral(value: string): boolean {
	return IPV4.test(value) || (value.includes(":") && IPV6.test(value));
}

/**
 * This request's visitor: the first X-Forwarded-For value, which can be
 * believed only because nginx (deploy/nginx/proxy.conf) replaces the header
 * with the address it saw (cloudflared's CF-Connecting-IP) instead of
 * appending to what a client sent. Discover's port is published nowhere
 * else. Undefined when there is no usable literal.
 */
export function visitorAddress(headers: Headers): string | undefined {
	const forwarded = headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim();
	return forwarded && isIpLiteral(forwarded) ? forwarded : undefined;
}

/**
 * `base` (else the global fetch) with `Authorization: Bearer <key>` and,
 * when there is one, X-Visitor-IP on every call; `base` as it is without a
 * key (development, tests).
 */
export function withServerKey(
	base: typeof fetch | undefined,
	key: string | null,
	address: string | undefined,
): typeof fetch | undefined {
	if (!key) return base;
	const wrapped = (input: RequestInfo | URL, init: RequestInit = {}) => {
		const headers = new Headers(init.headers);
		headers.set("authorization", `Bearer ${key}`);
		if (address) headers.set(VISITOR_IP_HEADER, address);
		return (base ?? globalThis.fetch)(input, { ...init, headers });
	};
	return wrapped as typeof fetch;
}

/** Why a read failed, in words that hold no address, header or query. */
function failure(error: unknown): string {
	if (error instanceof Error) {
		if (error.name === "TimeoutError" || error.name === "AbortError")
			return "no answer in time";
		// Node's fetch: TypeError("fetch failed") whose cause holds the code, or
		// an AggregateError of one attempt per address.
		const cause = (error as Error & { cause?: unknown }).cause as
			| { code?: unknown; errors?: { code?: unknown }[] }
			| undefined;
		const code = cause?.code ?? cause?.errors?.[0]?.code;
		return typeof code === "string" ? code : error.name;
	}
	return "failed";
}

/**
 * `base` (else the global fetch), logging each failed API read on one line:
 * a 5xx or 429 answer, or no answer at all (refused, reset, timed out). The
 * line names the method and path only (never the query, which holds a
 * visitor's search, or a header, which holds the key), the status and the
 * time taken, so `docker compose logs discover` shows an API outage or a
 * rate limit that the visitor sees as an error page. Other answers (404s
 * included) aren't failures and log nothing.
 */
export function withFailureLog(
	base: typeof fetch | undefined,
	log: (line: string) => void = console.error,
): typeof fetch {
	const wrapped = async (input: RequestInfo | URL, init?: RequestInit) => {
		const started = Date.now();
		const url = new URL(input instanceof Request ? input.url : String(input));
		const method = (
			init?.method ?? (input instanceof Request ? input.method : "GET")
		).toUpperCase();
		const what = `${method} ${url.pathname}`;
		try {
			const response = await (base ?? globalThis.fetch)(input, init);
			if (response.status >= 500 || response.status === 429)
				log(
					`Discover API read failed: ${what} answered ${response.status} (${Date.now() - started} ms)`,
				);
			return response;
		} catch (error) {
			log(
				`Discover API read failed: ${what}: ${failure(error)} (${Date.now() - started} ms)`,
			);
			throw error;
		}
	};
	return wrapped as typeof fetch;
}

/** The server's fetch for one request: failures logged, then the key and the visitor added. */
export function serverFetch(
	key: string | null,
	headers: Headers,
): typeof fetch | undefined {
	return withServerKey(withFailureLog(undefined), key, visitorAddress(headers));
}
