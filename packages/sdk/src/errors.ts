import type { ApiError } from "@tattoo-drip/types";

export interface TattooApiErrorOptions {
	/** Seconds from the response's `Retry-After` header. */
	retryAfter?: number;
	/** The underlying failure, for a network error. */
	cause?: unknown;
}

/**
 * A failed call to the Tattoo Drip API: a non-2xx response (`status` is the
 * HTTP status, `code` the API's machine-readable code), or no usable
 * response at all (`status` 0, with `timeout` or `network_error`).
 */
export class TattooApiError extends Error {
	readonly status: number;
	/** Stable machine-readable code, e.g. `not_found`, `validation_failed` or `timeout`. */
	readonly code: string;
	/** Field path → messages, set for `validation_failed`. */
	readonly fields: Record<string, string[]>;
	/** Seconds to wait before trying again, when the API said so (429). */
	readonly retryAfter: number | undefined;

	constructor(
		status: number,
		error?: Partial<ApiError>,
		options: TattooApiErrorOptions = {},
	) {
		super(error?.message ?? `Request failed with status ${status}`, {
			cause: options.cause,
		});
		this.name = "TattooApiError";
		this.status = status;
		this.code = error?.code ?? "unknown_error";
		this.fields = error?.fields ?? {};
		this.retryAfter = options.retryAfter;
	}
}

export function isTattooApiError(error: unknown): error is TattooApiError {
	return error instanceof TattooApiError;
}
