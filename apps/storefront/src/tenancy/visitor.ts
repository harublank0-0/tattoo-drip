/**
 * The visitor's address for the API's rate limits (TAT-38). Only the
 * server's keyed calls send it, as X-Visitor-IP; the API trusts it only
 * with a valid server key and uses it for nothing but counting. The
 * platform's name for this header is VISITOR_IP_HEADER in
 * #services/api_caller (the storefront may not import the platform).
 * Imports nothing: the browser loads src/api/context.ts, which imports
 * withVisitorAddress.
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
 * believed only because the edge in front of the server replaces the header
 * with the address it saw instead of appending to what a client sent:
 * Vercel's edge, or this deploy's nginx (`deploy/nginx`, which takes the
 * address from CF-Connecting-IP). A host that appends would let a visitor
 * pick the address the rate limits count. Else the socket address the
 * server exposes (srvx's `request.ip`), else none.
 */
export function visitorAddress(request: Request): string | undefined {
	const forwarded = request.headers
		.get("x-forwarded-for")
		?.split(",", 1)[0]
		?.trim();
	if (forwarded && isIpLiteral(forwarded)) return forwarded;
	const socket = (request as Request & { ip?: unknown }).ip;
	return typeof socket === "string" && isIpLiteral(socket) ? socket : undefined;
}

/** `base` (else the global fetch) with X-Visitor-IP on every call, when there is an address. */
export function withVisitorAddress(
	base: typeof fetch | undefined,
	address: string | undefined,
): typeof fetch | undefined {
	if (!address) return base;
	const wrapped = (input: RequestInfo | URL, init: RequestInit = {}) => {
		const headers = new Headers(init.headers);
		headers.set(VISITOR_IP_HEADER, address);
		return (base ?? globalThis.fetch)(input, { ...init, headers });
	};
	return wrapped as typeof fetch;
}
