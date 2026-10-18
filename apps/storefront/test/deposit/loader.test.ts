import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	connectServer,
	createApiContext,
	seedStudio,
} from "../../src/api/context.ts";
import { depositShell, loadDepositShell } from "../../src/deposit/loader.ts";
import { STUDIO } from "../studio/fixtures.ts";
import { fakeFetch, json } from "../tenancy/helpers.ts";

describe("the deposit page's loader", () => {
	test("reads the studio from the lookup's cache: no API call at all", async () => {
		const { calls, fetch } = fakeFetch(() =>
			json(500, { error: { code: "internal_error", message: "x" } }),
		);
		const api = createApiContext("server");
		connectServer(api, {
			config: { apiUrl: "http://api.test" },
			studio: STUDIO,
			fetch,
		});
		seedStudio(api, STUDIO);

		assert.deepEqual(await loadDepositShell(api), {
			studioName: "Black Needle",
			timezone: "Asia/Kathmandu",
			phone: "+9779812345678",
		});
		assert.equal(calls.length, 0);
	});

	test("cleans the name and drops a phone that isn't E.164", () => {
		assert.deepEqual(
			depositShell({
				...STUDIO,
				name: "  Black   Needle ",
				contact: { ...STUDIO.contact, phone: "9812345678" },
			}),
			{ studioName: "Black Needle", timezone: "Asia/Kathmandu", phone: null },
		);
	});
});
