import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createTattooClient, TattooApiError } from "../src/index.js";

type Call = { url: string; init: RequestInit };

/** A fetch that records each call and answers with `respond`. */
function fakeFetch(respond: (call: Call) => Response | Promise<Response>) {
	const calls: Call[] = [];
	const fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
		const call = { url: String(input), init };
		calls.push(call);
		return respond(call);
	};
	return { calls, fetch: fetch as typeof globalThis.fetch };
}

function json(
	status: number,
	body: unknown,
	headers: Record<string, string> = {},
) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json; charset=utf-8", ...headers },
	});
}

function client(
	fetch: typeof globalThis.fetch,
	options: { timeoutMs?: number } = {},
) {
	return createTattooClient({
		baseUrl: "https://api.example.com",
		tenant: "api-needle-32",
		fetch,
		...options,
	});
}

/** Rejects with the signal's reason once it aborts, as fetch does. */
function hangUntilAborted({ init }: Call): Promise<Response> {
	const signal = init.signal as AbortSignal;
	return new Promise((_, reject) => {
		signal.addEventListener("abort", () => reject(signal.reason), {
			once: true,
		});
	});
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
	try {
		await promise;
	} catch (error) {
		return error;
	}
	assert.fail("expected the call to reject");
}

describe("createTattooClient", () => {
	test("calls the tenant's /api/v1 URL without cookies and unwraps { data }", async () => {
		const { calls, fetch } = fakeFetch(() =>
			json(200, { data: { slug: "api-needle-32", name: "Black Needle" } }),
		);

		const studio = await client(fetch).studio.get();

		assert.deepEqual(studio, { slug: "api-needle-32", name: "Black Needle" });
		assert.equal(
			calls[0].url,
			"https://api.example.com/api/v1/tenants/api-needle-32",
		);
		assert.equal(calls[0].init.credentials, "omit");
		const headers = new Headers(calls[0].init.headers);
		assert.equal(headers.get("accept"), "application/json");
		assert.equal(headers.has("authorization"), false);
	});

	test("trims the base URL's trailing slashes and encodes the tenant", async () => {
		const { calls, fetch } = fakeFetch(() => json(200, { data: {} }));

		await createTattooClient({
			baseUrl: "https://api.example.com//",
			tenant: "a b/c",
			fetch,
		}).studio.get();

		assert.equal(
			calls[0].url,
			"https://api.example.com/api/v1/tenants/a%20b%2Fc",
		);
	});

	test("turns the error envelope into a TattooApiError with its fields", async () => {
		const { fetch } = fakeFetch(() =>
			json(422, {
				error: {
					code: "validation_failed",
					message: "Some fields are invalid.",
					fields: { "client.phone": ["Enter a phone number"] },
				},
			}),
		);

		const error = await rejection(client(fetch).studio.get());

		assert.ok(error instanceof TattooApiError);
		assert.equal(error.status, 422);
		assert.equal(error.code, "validation_failed");
		assert.equal(error.message, "Some fields are invalid.");
		assert.deepEqual(error.fields, {
			"client.phone": ["Enter a phone number"],
		});
		assert.equal(error.retryAfter, undefined);
	});

	test("an error without fields has empty fields", async () => {
		const { fetch } = fakeFetch(() =>
			json(404, { error: { code: "not_found", message: "Not found." } }),
		);

		const error = await rejection(client(fetch).studio.get());

		assert.ok(error instanceof TattooApiError);
		assert.equal(error.code, "not_found");
		assert.deepEqual(error.fields, {});
	});

	test("reads Retry-After from a 429", async () => {
		const { fetch } = fakeFetch(() =>
			json(
				429,
				{
					error: {
						code: "rate_limited",
						message: "Too many requests. Try again later.",
					},
				},
				{ "retry-after": "42" },
			),
		);

		const error = await rejection(client(fetch).studio.get());

		assert.ok(error instanceof TattooApiError);
		assert.equal(error.code, "rate_limited");
		assert.equal(error.retryAfter, 42);
	});

	test("a non-JSON error keeps its status with unknown_error", async () => {
		const { fetch } = fakeFetch(
			() =>
				new Response("<html>Bad gateway</html>", {
					status: 502,
					headers: { "content-type": "text/html" },
				}),
		);

		const error = await rejection(client(fetch).studio.get());

		assert.ok(error instanceof TattooApiError);
		assert.equal(error.status, 502);
		assert.equal(error.code, "unknown_error");
	});

	test("a 200 without data is an invalid_response", async () => {
		const { fetch } = fakeFetch(() => json(200, { ok: true }));

		const error = await rejection(client(fetch).studio.get());

		assert.ok(error instanceof TattooApiError);
		assert.equal(error.code, "invalid_response");
	});

	test("a network failure is a network_error with status 0 and its cause", async () => {
		const failure = new TypeError("fetch failed");
		const { fetch } = fakeFetch(() => {
			throw failure;
		});

		const error = await rejection(client(fetch).studio.get());

		assert.ok(error instanceof TattooApiError);
		assert.equal(error.status, 0);
		assert.equal(error.code, "network_error");
		assert.equal(error.cause, failure);
	});

	test("a call that takes too long is a timeout", {
		timeout: 2000,
	}, async () => {
		const { fetch } = fakeFetch(hangUntilAborted);

		const error = await rejection(
			client(fetch, { timeoutMs: 20 }).studio.get(),
		);

		assert.ok(error instanceof TattooApiError);
		assert.equal(error.status, 0);
		assert.equal(error.code, "timeout");
	});

	test("a body that stops streaming is a timeout too", {
		timeout: 2000,
	}, async () => {
		const { fetch } = fakeFetch(({ init }) => {
			const signal = init.signal as AbortSignal;
			const body = new ReadableStream({
				start(controller) {
					controller.enqueue(new TextEncoder().encode('{"data":'));
					signal.addEventListener(
						"abort",
						() => controller.error(signal.reason),
						{
							once: true,
						},
					);
				},
			});
			return new Response(body, {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		});

		const error = await rejection(
			client(fetch, { timeoutMs: 20 }).studio.get(),
		);

		assert.ok(error instanceof TattooApiError);
		assert.equal(error.code, "timeout");
	});

	test("a call the caller cancels rejects with the AbortError", {
		timeout: 2000,
	}, async () => {
		const { fetch } = fakeFetch(hangUntilAborted);
		const controller = new AbortController();

		const call = client(fetch).studio.get({ signal: controller.signal });
		controller.abort();
		const error = await rejection(call);

		assert.ok(!(error instanceof TattooApiError));
		assert.equal((error as Error).name, "AbortError");
	});
});
