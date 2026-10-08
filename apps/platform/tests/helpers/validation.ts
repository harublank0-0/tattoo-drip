import type { ApiResponse } from "@japa/api-client";

/**
 * Asserts the request was bounced back with a validation error on `field`.
 *
 * Adonis 7 with Inertia flashes field errors under `inputErrorsBag`; the
 * session plugin's own `assertHasValidationError` still reads `errors`, so
 * it never sees them.
 */
export function assertValidationError(
	response: ApiResponse,
	field: string,
	message?: string,
) {
	const errors = response.flashMessage("inputErrorsBag") ?? {};
	if (!response.assert) {
		throw new Error("assertValidationError needs the @japa/assert plugin");
	}
	response.assert.property(
		errors,
		field,
		`expected a validation error on "${field}", got ${JSON.stringify(errors)}`,
	);
	if (message !== undefined) {
		response.assert.include(errors[field], message);
	}
}
