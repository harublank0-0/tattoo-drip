import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { TattooApiError } from "@tattoo-drip/sdk";
import {
	isUnavailable,
	rethrowUnavailable,
	UNAVAILABLE_MESSAGE,
} from "../src/lib/api-errors.ts";

describe("Discover's unavailable errors", () => {
	test("no answer, a timeout, a 5xx and a 429 are unavailable; a 4xx and a bug are not", () => {
		for (const status of [0, 429, 500, 503]) {
			assert.equal(
				isUnavailable(new TattooApiError(status, { code: "x", message: "x" })),
				true,
				String(status),
			);
		}
		for (const status of [400, 404, 422]) {
			assert.equal(
				isUnavailable(new TattooApiError(status, { code: "x", message: "x" })),
				false,
				String(status),
			);
		}
		assert.equal(isUnavailable(new Error("bug")), false);
	});

	test("the loader's rethrow keeps the meaning across serialisation: only the message survives", () => {
		const down = new TattooApiError(0, {
			code: "network",
			message: "could not be reached",
		});
		assert.throws(
			() => rethrowUnavailable(down),
			(error: Error) => {
				// What the browser gets after the server's error is serialised.
				const copy = new Error(error.message);
				assert.equal(copy.message, UNAVAILABLE_MESSAGE);
				assert.equal(isUnavailable(copy), true);
				return true;
			},
		);
		const missing = new TattooApiError(404, {
			code: "not_found",
			message: "x",
		});
		assert.throws(
			() => rethrowUnavailable(missing),
			(error) => error === missing,
		);
	});
});
