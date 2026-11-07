import { isTattooApiError } from "@tattoo-drip/sdk";

/**
 * The message of a read that failed because the API is unreachable, slow or
 * busy. A loader rethrows such a failure with this message (`unavailable`),
 * because the server's error reaches the browser as a plain Error: the
 * message survives, a TattooApiError's class and status don't.
 */
export const UNAVAILABLE_MESSAGE = "Discover's data is unavailable right now.";

/** A failure asking again later can fix: no answer, a timeout, a 5xx or a 429. */
export function isUnavailable(error: unknown): boolean {
	if (isTattooApiError(error)) {
		return error.status === 0 || error.status === 429 || error.status >= 500;
	}
	return error instanceof Error && error.message === UNAVAILABLE_MESSAGE;
}

/** For a loader's `.catch`: a transient failure becomes the marked error, anything else stays itself. */
export function rethrowUnavailable(error: unknown): never {
	if (isUnavailable(error))
		throw new Error(UNAVAILABLE_MESSAGE, { cause: error });
	throw error;
}
