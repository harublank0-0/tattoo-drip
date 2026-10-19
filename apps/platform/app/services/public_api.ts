import type { IncomingMessage, ServerResponse } from "node:http";
import type { HttpContext } from "@adonisjs/core/http";

/**
 * The public API (TAT-32). Everything under this prefix is stateless and
 * cookieless (the session, CSRF, auth and Inertia middleware skip it), has
 * CORS open without credentials, and answers with the { data } / { error }
 * envelopes. Type imports only: config/app.ts and config/cors.ts load this
 * file at boot, before the router and the other services exist.
 */
export const API_PREFIX = "/api";

/** Methods that only read, so an old slug may serve them (TAT-24). */
export const READ_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD"]);

/**
 * True for a public API request: the matched route's pattern, or before
 * routing (and for a URL no route matches) the URL path, is /api or below
 * it. Once a route matched, its pattern decides, so no URL can strip the
 * session from a dashboard route.
 */
export function isApiRequest(ctx: HttpContext): boolean {
	const path = ctx.route?.pattern ?? ctx.request.url();
	return path === API_PREFIX || path.startsWith(`${API_PREFIX}/`);
}

/**
 * Headers every API response carries, errors included. Nothing is cacheable
 * unless its route opts in (the publicCache middleware). The allow-origin
 * header is also sent without an Origin, so a CDN copy fetched server-side
 * works in a browser; the value never varies, so no Vary: Origin. Shield,
 * which sets nosniff on pages, does not run on the API.
 */
export const API_HEADERS = {
	"Cache-Control": "no-store",
	"Access-Control-Allow-Origin": "*",
	"X-Content-Type-Options": "nosniff",
} as const;

export function setApiHeaders(response: HttpContext["response"]) {
	for (const [name, value] of Object.entries(API_HEADERS)) {
		response.header(name, value);
	}
}

/**
 * Every code the public API answers with (openapi.yaml, ErrorResponse): the
 * shared ones, then each endpoint's own.
 */
export type ApiErrorCode =
	| "bad_request"
	| "not_found"
	| "method_not_allowed"
	| "payload_too_large"
	| "unsupported_media_type"
	| "validation_failed"
	| "rate_limited"
	| "internal_error"
	| "request_timeout"
	| "service_busy"
	// createInquiry (TAT-51)
	| "artist_not_accepting"
	| "studio_not_accepting"
	| "too_many_open_inquiries"
	| "challenge_failed"
	| "challenge_unavailable"
	// submitDepositProof (TAT-65)
	| "deposit_not_due"
	| "deposit_changed";

export type ErrorKind = { status: number; code: string; message: string };

/** Each code with its status and its one message for people. */
export const API_ERRORS: Record<ApiErrorCode, ErrorKind> = {
	bad_request: {
		status: 400,
		code: "bad_request",
		message: "The request could not be read.",
	},
	not_found: { status: 404, code: "not_found", message: "Not found." },
	method_not_allowed: {
		status: 405,
		code: "method_not_allowed",
		message: "This method is not allowed here.",
	},
	payload_too_large: {
		status: 413,
		code: "payload_too_large",
		message: "The request is too large.",
	},
	unsupported_media_type: {
		status: 415,
		code: "unsupported_media_type",
		message: "This content type or encoding is not supported.",
	},
	validation_failed: {
		status: 422,
		code: "validation_failed",
		message: "Some fields are invalid.",
	},
	rate_limited: {
		status: 429,
		code: "rate_limited",
		message: "Too many requests. Try again later.",
	},
	internal_error: {
		status: 500,
		code: "internal_error",
		message: "Something went wrong. Try again later.",
	},
	request_timeout: {
		status: 408,
		code: "request_timeout",
		message: "The upload took too long. Try again on a faster connection.",
	},
	service_busy: {
		status: 503,
		code: "service_busy",
		message: "We're busy right now. Try again in a moment.",
	},
	artist_not_accepting: {
		status: 409,
		code: "artist_not_accepting",
		message:
			"This artist isn't taking new requests right now. Choose another artist, or none.",
	},
	studio_not_accepting: {
		status: 409,
		code: "studio_not_accepting",
		message: "This studio isn't taking new requests right now.",
	},
	too_many_open_inquiries: {
		status: 409,
		code: "too_many_open_inquiries",
		message:
			"You already have requests waiting with this studio. They will reply on WhatsApp or Viber.",
	},
	// The intake's bot challenge and honeypot (TAT-55): one message, never why.
	challenge_failed: {
		status: 403,
		code: "challenge_failed",
		message:
			"We couldn't confirm this request came from a person. Please try again.",
	},
	challenge_unavailable: {
		status: 503,
		code: "challenge_unavailable",
		message: "We couldn't run the security check. Try again in a minute.",
	},
	deposit_not_due: {
		status: 409,
		code: "deposit_not_due",
		message:
			"This deposit can't be paid here right now. Reload the page to see why.",
	},
	deposit_changed: {
		status: 409,
		code: "deposit_changed",
		message:
			"The deposit amount changed. Check the new amount before you upload.",
	},
};

/** Seconds a busy answer (service_busy, a write already in flight) asks a client to wait (TAT-38). */
export const RETRY_AFTER_BUSY_SECONDS = 10;

/** A raw request URL under /api (not decoded: decoding is what failed). */
const RAW_API_URL = /^\/api(?:[/?#]|$)/;

/**
 * The server's answer to a URL it cannot decode (a lone %, invalid UTF-8),
 * given before any middleware or the exception handler exists. An /api URL
 * gets the bad_request envelope with the API headers, so a browser client
 * can read it; any other URL keeps the framework's plain-text 400. No
 * session, no cookie.
 */
export function onBadUrl(req: IncomingMessage, res: ServerResponse) {
	if (!RAW_API_URL.test(req.url ?? "")) {
		res.writeHead(400, { "Content-Type": "text/plain" });
		res.end("Bad Request");
		return;
	}
	const { code, message, status } = API_ERRORS.bad_request;
	res.writeHead(status, {
		...API_HEADERS,
		"Content-Type": "application/json; charset=utf-8",
	});
	res.end(JSON.stringify({ error: { code, message } }));
}

export type PublicCacheOptions = {
	maxAge?: number;
	staleWhileRevalidate?: number;
};

/**
 * Seconds for a cacheable public read: an owner's edit shows within a
 * minute, and a quiet studio page stays fast while one request refreshes it.
 */
export const PUBLIC_CACHE = { maxAge: 60, staleWhileRevalidate: 600 } as const;

/** The Cache-Control value of a cacheable public read. */
export function publicCacheControl({
	maxAge = PUBLIC_CACHE.maxAge,
	staleWhileRevalidate = PUBLIC_CACHE.staleWhileRevalidate,
}: PublicCacheOptions = {}) {
	return `public, max-age=${maxAge}, stale-while-revalidate=${staleWhileRevalidate}`;
}
