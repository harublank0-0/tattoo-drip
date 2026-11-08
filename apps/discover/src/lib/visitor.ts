/**
 * Discover's server key and its visitor's address (D11), sent with every
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
