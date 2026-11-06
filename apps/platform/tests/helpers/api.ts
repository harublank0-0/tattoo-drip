import type { ApiResponse } from "@japa/api-client";

/**
 * Assertions for public API responses (TAT-32). TAT-47 validates the bodies
 * against openapi.yaml here, so every API test gets the contract check.
 */

/** `{ data }` and nothing else, with the status. */
export function assertApiData(
	response: ApiResponse,
	data: unknown,
	status = 200,
) {
	response.assertStatus(status);
	assertOf(response).deepEqual(response.body(), { data });
}

/**
 * The error envelope with this code and nothing else, `no-store`, and the
 * headers every API response has.
 */
export function assertApiError(
	response: ApiResponse,
	status: number,
	code: string,
) {
	const assert = assertOf(response);
	response.assertStatus(status);
	const body = response.body();
	assert.sameMembers(
		Object.keys(body),
		["error"],
		"an error body has only `error`",
	);
	assert.equal(body.error.code, code);
	assert.isString(body.error.message);
	assert.sameMembers(
		Object.keys(body.error),
		body.error.fields ? ["code", "message", "fields"] : ["code", "message"],
	);
	assert.equal(response.header("cache-control"), "no-store");
	assertApiHeaders(response);
}

/** Headers every API response has, and the cookie it never has. */
export function assertApiHeaders(response: ApiResponse) {
	const assert = assertOf(response);
	// Never a wildcard: only an allowed browser origin is echoed (Discover D01),
	// so every answer varies by Origin.
	assert.notEqual(response.header("access-control-allow-origin"), "*");
	assert.match(response.header("vary") ?? "", /\borigin\b/i);
	assert.isUndefined(response.header("access-control-allow-credentials"));
	assert.equal(response.header("x-content-type-options"), "nosniff");
	assertNoCookies(response);
}

export function assertNoCookies(response: ApiResponse) {
	assertOf(response).notProperty(response.headers(), "set-cookie");
}

function assertOf(response: ApiResponse) {
	if (!response.assert) {
		throw new Error("the API assertions need the @japa/assert plugin");
	}
	return response.assert;
}
