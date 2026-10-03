import type { ApiError } from "@tattoo-drip/types";

/** A non-2xx response (or an unreadable body) from the Tattoo Drip API. */
export class TattooApiError extends Error {
	readonly status: number;
	/** Stable machine-readable code, e.g. `validation_failed` or `slot_unavailable`. */
	readonly code: string;
	/** Field path → messages, set for validation errors. */
	readonly fields: Record<string, string[]>;

	constructor(status: number, error?: Partial<ApiError>) {
		super(error?.message ?? `Request failed with status ${status}`);
		this.name = "TattooApiError";
		this.status = status;
		this.code = error?.code ?? "unknown_error";
		this.fields = error?.fields ?? {};
	}
}

export function isTattooApiError(error: unknown): error is TattooApiError {
	return error instanceof TattooApiError;
}
