import type net from "node:net";
import testUtils from "@adonisjs/core/services/test_utils";
import limiter from "@adonisjs/limiter/services/main";
import { test } from "@japa/runner";
import { apiLimitFor } from "#services/api_limits";
import { writeSlots } from "#services/write_slots";
import { assertApiData, assertApiError } from "#tests/helpers/api";
import { rawRequest, waitFor } from "#tests/helpers/raw_http";
import { studioWithOwner } from "#tests/helpers/tenants";

/** A write that takes a slot and keeps it: its body never finishes. */
const holdUpload = (ip: string) =>
	rawRequest(
		[
			"POST /api/v1/__test/hold HTTP/1.1",
			"Content-Type: multipart/form-data; boundary=td38",
			"Content-Length: 1000000",
			`X-Forwarded-For: ${ip}`,
		],
		'--td38\r\nContent-Disposition: form-data; name="a"\r\n\r\npartial',
	);

test.group("Public API: write slots", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("two writes per address and four per process at once; a slot frees when its client hangs up", async ({
		client,
		assert,
	}) => {
		const sockets: net.Socket[] = [];
		const write = (ip: string) =>
			client
				.post("/api/v1/__test/hold")
				.header("x-forwarded-for", ip)
				.field("a", "b");
		try {
			sockets.push(
				await holdUpload("203.0.113.60"),
				await holdUpload("203.0.113.60"),
			);
			await waitFor(() => writeSlots.inFlight === 2, "two held writes");

			const third = await write("203.0.113.60");
			assertApiError(third, 429, "rate_limited");
			assert.equal(third.header("retry-after"), "10");

			sockets.push(
				await holdUpload("203.0.113.61"),
				await holdUpload("203.0.113.61"),
			);
			await waitFor(() => writeSlots.inFlight === 4, "four held writes");

			const busy = await write("203.0.113.62");
			assertApiError(busy, 503, "service_busy");
			assert.equal(busy.header("retry-after"), "10");

			sockets.shift()?.destroy();
			await waitFor(
				() => writeSlots.inFlight === 3,
				"a slot freed by a client that hung up",
			);
			assertApiData(await write("203.0.113.62"), { ok: true });
		} finally {
			for (const socket of sockets) socket.destroy();
			await waitFor(() => writeSlots.inFlight === 0, "every slot freed");
		}
	});

	test("reads never take a slot; a refused write still counts", async ({
		client,
		assert,
	}) => {
		await studioWithOwner("slots-38");
		const sockets: net.Socket[] = [];
		try {
			for (const ip of [
				"203.0.113.63",
				"203.0.113.63",
				"203.0.113.64",
				"203.0.113.64",
			]) {
				sockets.push(await holdUpload(ip));
			}
			await waitFor(() => writeSlots.inFlight === 4, "four held writes");

			(
				await client
					.get("/api/v1/tenants/slots-38")
					.header("x-forwarded-for", "203.0.113.65")
			).assertStatus(200);
			assertApiError(
				await client
					.post("/api/v1/__test/hold")
					.header("x-forwarded-for", "203.0.113.65")
					.field("a", "b"),
				503,
				"service_busy",
			);
			const { key, budget } = apiLimitFor("callerWrites", {
				kind: "anonymous",
				ip: "203.0.113.65",
			});
			assert.equal((await limiter.use({ ...budget }).get(key))?.consumed, 1);
		} finally {
			for (const socket of sockets) socket.destroy();
			await waitFor(() => writeSlots.inFlight === 0, "every slot freed");
		}
	});
});
