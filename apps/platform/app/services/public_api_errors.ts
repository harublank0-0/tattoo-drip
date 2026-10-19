import { type HttpContext, errors as httpErrors } from "@adonisjs/core/http";
import router from "@adonisjs/core/services/router";
import { errors as limiterErrors } from "@adonisjs/limiter";
import { errors as vineErrors } from "@vinejs/vine";
import {
	API_ERRORS,
	type ApiErrorCode,
	type ErrorKind,
	RETRY_AFTER_BUSY_SECONDS,
	setApiHeaders,
} from "#services/public_api";

export { API_ERRORS, type ApiErrorCode };

/**
 * Shared codes for framework errors that carry a 4xx status. 422 is not
 * here: only a VineJS error is validation_failed.
 */
const CODE_BY_STATUS: Partial<Record<number, ApiErrorCode>> = {
	400: "bad_request",
	404: "not_found",
	405: "method_not_allowed",
	408: "request_timeout",
	413: "payload_too_large",
	415: "unsupported_media_type",
	429: "rate_limited",
};

/**
 * An error a public endpoint answers with on purpose: a code from
 * API_ERRORS (`ApiException.of`), or a one-off (such as an endpoint's own,
 * listed in openapi.yaml). Its message is shown to people: keep it plain and safe.
 * `fields` (field path to messages) belongs to `validation_failed` only, as
 * the contract says; any other code with fields is refused at construction.
 */
export class ApiException extends Error {
	/** Seconds for Retry-After, for a refusal a client should retry later. */
	retryAfter?: number;

	constructor(
		status: number,
		code: "validation_failed",
		message: string,
		fields: Record<string, string[]>,
	);
	constructor(status: number, code: string, message: string);
	constructor(
		readonly status: number,
		readonly code: string,
		message: string,
		readonly fields?: Record<string, string[]>,
	) {
		super(message);
		this.name = "ApiException";
		if (fields && code !== "validation_failed") {
			throw new TypeError(
				`ApiException "${code}" cannot carry fields: only validation_failed does`,
			);
		}
	}

	/** A refusal to retry after `seconds` (TAT-38: write slots). */
	static retryLater(code: "rate_limited" | "service_busy", seconds: number) {
		const error = ApiException.of(code);
		error.retryAfter = seconds;
		return error;
	}

	/** The 404 of an unknown tenant or record: one answer for every reason. */
	static notFound() {
		return new ApiException(404, "not_found", API_ERRORS.not_found.message);
	}

	/**
	 * The error for one of the codes in API_ERRORS, with its status and
	 * message. `fields` go with `validation_failed` only.
	 */
	static of(
		code: "validation_failed",
		fields?: Record<string, string[]>,
	): ApiException;
	static of(code: Exclude<ApiErrorCode, "validation_failed">): ApiException;
	static of(code: ApiErrorCode, fields?: Record<string, string[]>) {
		const { status, message } = API_ERRORS[code];
		return code === "validation_failed" && fields
			? new ApiException(status, code, message, fields)
			: new ApiException(status, code, message);
	}
}

export type ApiErrorBody = {
	error: { code: string; message: string; fields?: Record<string, string[]> };
};

export type ApiErrorResponse = {
	status: number;
	body: ApiErrorBody;
	headers: Record<string, string>;
};

/**
 * The response for an error on a public endpoint. `allow` lists the methods
 * the URL accepts when the router found no route for the request's method
 * (a 405); leave it empty otherwise. Never includes an error's own message,
 * stack or details, in any environment.
 */
export function apiErrorFor(
	error: unknown,
	allow: string[] = [],
): ApiErrorResponse {
	if (error instanceof ApiException) {
		return respond(
			error,
			error.fields,
			error.retryAfter === undefined
				? {}
				: { "Retry-After": String(error.retryAfter) },
		);
	}
	if (error instanceof vineErrors.E_VALIDATION_ERROR) {
		return respond(API_ERRORS.validation_failed, fieldsOf(error.messages));
	}
	if (error instanceof limiterErrors.E_TOO_MANY_REQUESTS) {
		const headers = error.headers ?? error.getDefaultHeaders();
		return respond(API_ERRORS.rate_limited, undefined, stringValues(headers));
	}
	if (error instanceof httpErrors.E_ROUTE_NOT_FOUND && allow.length > 0) {
		return respond(API_ERRORS.method_not_allowed, undefined, {
			Allow: allow.join(", "),
		});
	}
	// No pooled connection within the pool's wait (#services/db_pool).
	if (error instanceof Error && error.name === "KnexTimeoutError") {
		return respond(API_ERRORS.service_busy, undefined, {
			"Retry-After": String(RETRY_AFTER_BUSY_SECONDS),
		});
	}
	const status = statusOf(error);
	if (status !== undefined && status >= 400 && status < 500) {
		const code = CODE_BY_STATUS[status];
		if (code) return respond(API_ERRORS[code]);
		// A 422 that isn't a VineJS error is a body the parser refused (strict
		// JSON: a bare string or number). Any other 4xx keeps its status.
		return respond({
			...API_ERRORS.bad_request,
			status: status === 422 ? 400 : status,
		});
	}
	return respond(API_ERRORS.internal_error);
}

/**
 * Whether an API error goes to the log: server errors do, a client's
 * mistakes (4xx) don't, and neither does a deliberate busy refusal (a write
 * slot, TAT-38). A pool timeout is a server error: it is logged.
 */
export function apiErrorIsReported(error: unknown): boolean {
	if (error instanceof ApiException && error.code === "service_busy") {
		return false;
	}
	return apiErrorFor(error).status >= 500;
}

/**
 * Answers a failed public API request with the error envelope; the
 * exception handler calls it for every /api request. A URL the router has
 * no route for under this method, but has one under another, is a 405.
 */
export function renderApiError(error: unknown, ctx: HttpContext) {
	const allow = isRouteMiss(error, ctx)
		? allowedMethods(ctx.request.url())
		: [];
	const { status, body, headers } = apiErrorFor(error, allow);
	setApiHeaders(ctx.response);
	for (const [name, value] of Object.entries(headers)) {
		ctx.response.header(name, value);
	}
	// Answered before its body arrived (a refusal, a deadline): close the
	// connection rather than let Node read the rest of a slow body (TAT-38).
	if (ctx.request.hasBody() && !ctx.request.request.complete) {
		ctx.response.header("Connection", "close");
	}
	ctx.response.status(status).json(body);
}

function respond(
	kind: ErrorKind,
	fields?: Record<string, string[]>,
	headers: Record<string, string> = {},
): ApiErrorResponse {
	return {
		status: kind.status,
		body: {
			error: {
				code: kind.code,
				message: kind.message,
				...(fields ? { fields } : {}),
			},
		},
		headers,
	};
}

/** VineJS messages grouped by field path. */
function fieldsOf(messages: { field: string; message: string }[]) {
	const fields: Record<string, string[]> = {};
	for (const { field, message } of messages) {
		fields[field] = [...(fields[field] ?? []), message];
	}
	return fields;
}

function stringValues(headers: Record<string, unknown>) {
	return Object.fromEntries(
		Object.entries(headers).map(([name, value]) => [name, String(value)]),
	);
}

function statusOf(error: unknown): number | undefined {
	if (typeof error !== "object" || error === null || !("status" in error)) {
		return undefined;
	}
	return typeof error.status === "number" ? error.status : undefined;
}

/**
 * The router found no route at all. A 404 thrown inside a matched route
 * (an unknown tenant) has ctx.route set and stays a 404.
 */
function isRouteMiss(error: unknown, ctx: HttpContext) {
	return error instanceof httpErrors.E_ROUTE_NOT_FOUND && !ctx.route;
}

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

/** The methods some route accepts for this URL, HEAD along with GET. */
function allowedMethods(url: string): string[] {
	const allowed = METHODS.filter(
		(method) => router.match(url, method, false) !== null,
	);
	return allowed.includes("GET")
		? ["GET", "HEAD", ...allowed.filter((method) => method !== "GET")]
		: allowed;
}
