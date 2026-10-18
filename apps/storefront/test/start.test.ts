import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { csrfSymbol } from "@tanstack/react-start";
import { startInstance } from "../src/start.ts";
import { tenantMiddleware } from "../src/tenancy/middleware.ts";

describe("startInstance", () => {
	test("keeps Start's CSRF check, ahead of the studio lookup", async () => {
		// A global request middleware replaces Start's default CSRF check on
		// server functions, so start.ts must add it back, and first: a
		// cross-site call is refused before any API request is made.
		const { requestMiddleware } = await startInstance.getOptions();

		assert.ok(requestMiddleware, "request middleware is registered");
		assert.equal(requestMiddleware.length, 2);
		assert.ok(csrfSymbol in requestMiddleware[0], "CSRF check is first");
		assert.equal(requestMiddleware[1], tenantMiddleware);
	});
});
