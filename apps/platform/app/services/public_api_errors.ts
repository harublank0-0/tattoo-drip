import { type HttpContext, errors as httpErrors } from "@adonisjs/core/http";
import router from "@adonisjs/core/services/router";
import { errors as limiterErrors } from "@adonisjs/limiter";
import { errors as vineErrors } from "@vinejs/vine";
import {
	API_ERRORS,
	type ApiErrorCode,
	type ErrorKind,
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
	413: "payload_too_large",
	415: "unsupported_media_type",
	429: "rate_limited",
};

/**
 * An error a public endpoint answers with on purpose: a shared code, or the
 * endpoint's own (such as `too_many_open_inquiries`, listed in
 * openapi.yaml). Its message is shown to people: keep it plain and safe.
 */
export class ApiException extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
		message: string,
		readonly fields?: Record<string, string[]>,
	) {
		super(message);
		this.name = "ApiException";
	}

	/** The 404 of an unknown tenant or record: one answer for every reason. */
	static notFound() {
		return new ApiException(404, "not_found", API_ERRORS.not_found.message);
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
	if (error instanceof ApiException) return respond(error, error.fields);
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
