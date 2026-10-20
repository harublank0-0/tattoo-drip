import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	type Artist,
	type CreateInquiryInput,
	createTattooClient,
	INQUIRY_CHALLENGE_ACTION,
	INQUIRY_HONEYPOT_FIELD,
	isTattooApiError,
	type Studio,
	TattooApiError,
} from "../src/index.js";

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

/** Runs `fn` as if in a browser (a global `document`), then puts the global back. */
function inBrowser<T>(fn: () => T): T {
	const had = Object.hasOwn(globalThis, "document");
	Object.defineProperty(globalThis, "document", {
		value: {},
		configurable: true,
		writable: true,
	});
	try {
		return fn();
	} finally {
		if (!had) delete (globalThis as { document?: unknown }).document;
	}
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

	test("a 200 whose JSON isn't an object is an invalid_response, whatever it holds", async () => {
		for (const raw of [
			'"secret text"',
			"5",
			"true",
			"null",
			"0",
			"false",
			"[]",
			'[{"data":1}]',
		]) {
			const { fetch } = fakeFetch(
				() =>
					new Response(raw, {
						status: 200,
						headers: { "content-type": "application/json" },
					}),
			);

			const error = await rejection(client(fetch).studio.get());

			assert.ok(error instanceof TattooApiError, raw);
			assert.equal(error.status, 200, raw);
			assert.equal(error.code, "invalid_response", raw);
			assert.ok(!error.message.includes("secret"), raw);
		}
	});

	test("an error whose JSON isn't an object keeps its status with unknown_error", async () => {
		for (const raw of ['"secret text"', "5", "true", "[]"]) {
			const { fetch } = fakeFetch(
				() =>
					new Response(raw, {
						status: 502,
						headers: { "content-type": "application/json" },
					}),
			);

			const error = await rejection(client(fetch).studio.get());

			assert.ok(error instanceof TattooApiError, raw);
			assert.equal(error.status, 502, raw);
			assert.equal(error.code, "unknown_error", raw);
		}
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

describe("inquiries.create", () => {
	const ID = "0195f3a0-0000-7000-8000-000000000051";
	const input = {
		idea: "Fine-line peony",
		placement: "Left forearm",
		approximateSize: "About 10 cm",
		preferredDates: "Any weekday in November",
		sourceChannel: "instagram",
		contactName: "Ana",
		contactPhone: "9812345678",
	} satisfies CreateInquiryInput;

	test("posts one multipart form to the tenant's inquiries, the token in a header, without cookies", async () => {
		const { calls, fetch } = fakeFetch(() => json(201, { data: { id: ID } }));
		const front = new File([new Uint8Array([0xff, 0xd8, 0xff])], "front.jpg", {
			type: "image/jpeg",
		});
		const side = new Blob([new Uint8Array([0x89, 0x50])], {
			type: "image/png",
		});

		const receipt = await client(fetch).inquiries.create({
			...input,
			preferredArtistId: "0195f3a0-0000-7000-8000-0000000000aa",
			budget: undefined,
			contactEmail: null,
			referenceImages: [front, side],
			challengeToken: "token-51",
		});

		assert.deepEqual(receipt, { id: ID });
		assert.equal(
			calls[0].url,
			"https://api.example.com/api/v1/tenants/api-needle-32/inquiries",
		);
		assert.equal(calls[0].init.method, "POST");
		assert.equal(calls[0].init.credentials, "omit");
		const headers = new Headers(calls[0].init.headers);
		assert.equal(headers.get("accept"), "application/json");
		assert.equal(
			headers.has("content-type"),
			false,
			"fetch sets the multipart boundary",
		);
		const form = calls[0].init.body as FormData;
		assert.deepEqual([...new Set(form.keys())].sort(), [
			"approximateSize",
			"contactName",
			"contactPhone",
			"idea",
			"placement",
			"preferredArtistId",
			"preferredDates",
			"referenceImages",
			"sourceChannel",
		]);
		assert.equal(form.get("contactPhone"), "9812345678");
		assert.equal(headers.get("x-challenge-token"), "token-51");
		assert.equal(form.has("challengeToken"), false);
		const images = form.getAll("referenceImages") as File[];
		assert.deepEqual(
			images.map(({ name, type }) => [name, type]),
			[
				["front.jpg", "image/jpeg"],
				["blob", "image/png"],
			],
		);
	});

	test("without images or a token it sends only the fields", async () => {
		const { calls, fetch } = fakeFetch(() => json(201, { data: { id: ID } }));

		await client(fetch).inquiries.create(input);

		const form = calls[0].init.body as FormData;
		assert.equal(form.has("referenceImages"), false);
		assert.equal(form.has("challengeToken"), false);
		assert.equal(form.has(INQUIRY_HONEYPOT_FIELD), false);
		assert.equal(
			new Headers(calls[0].init.headers).has("x-challenge-token"),
			false,
		);
		assert.equal(form.get("idea"), "Fine-line peony");
	});

	test("a refusal is a TattooApiError with its code, and fields on validation_failed", async () => {
		const full = fakeFetch(() =>
			json(409, {
				error: {
					code: "too_many_open_inquiries",
					message:
						"You already have requests waiting with this studio. They will reply on WhatsApp or Viber.",
				},
			}),
		);
		const invalid = fakeFetch(() =>
			json(422, {
				error: {
					code: "validation_failed",
					message: "Some fields are invalid.",
					fields: {
						contactPhone: [
							"Enter a phone number, like 9812345678 or +977 1 4123456.",
						],
					},
				},
			}),
		);

		const capped = await rejection(client(full.fetch).inquiries.create(input));
		const refused = await rejection(
			client(invalid.fetch).inquiries.create(input),
		);

		assert.ok(capped instanceof TattooApiError);
		assert.equal(capped.status, 409);
		assert.equal(capped.code, "too_many_open_inquiries");
		assert.ok(refused instanceof TattooApiError);
		assert.deepEqual(Object.keys(refused.fields), ["contactPhone"]);
	});

	test("an upload waits longer than the client's timeout", {
		timeout: 2000,
	}, async () => {
		// Unlike the plain fake, this fetch gives up when its signal aborts, so
		// the test fails if the upload still used the client's 20 ms.
		const { fetch } = fakeFetch(
			({ init }) =>
				new Promise<Response>((resolve, reject) => {
					const signal = init.signal as AbortSignal;
					signal.addEventListener("abort", () => reject(signal.reason), {
						once: true,
					});
					setTimeout(() => resolve(json(201, { data: { id: ID } })), 60);
				}),
		);

		const receipt = await client(fetch, { timeoutMs: 20 }).inquiries.create(
			input,
		);

		assert.deepEqual(receipt, { id: ID });
	});

	test("a per-call timeoutMs still gives up", { timeout: 2000 }, async () => {
		const { fetch } = fakeFetch(hangUntilAborted);

		const error = await rejection(
			client(fetch).inquiries.create(input, { timeoutMs: 20 }),
		);

		assert.ok(error instanceof TattooApiError);
		assert.equal(error.code, "timeout");
	});

	test("a submission the caller cancels rejects with the AbortError", {
		timeout: 2000,
	}, async () => {
		const { fetch } = fakeFetch(hangUntilAborted);
		const controller = new AbortController();

		const call = client(fetch).inquiries.create(input, {
			signal: controller.signal,
		});
		controller.abort();
		const error = await rejection(call);

		assert.ok(!(error instanceof TattooApiError));
		assert.equal((error as Error).name, "AbortError");
	});

	test("the honeypot goes as the website field, only when it holds something", async () => {
		const { calls, fetch } = fakeFetch(() => json(201, { data: { id: ID } }));

		await client(fetch).inquiries.create({ ...input, honeypot: "" });
		await client(fetch).inquiries.create({
			...input,
			honeypot: "https://spam.example",
		});

		const [empty, filled] = calls.map((call) => call.init.body as FormData);
		assert.equal(empty.has(INQUIRY_HONEYPOT_FIELD), false);
		assert.equal(filled.get(INQUIRY_HONEYPOT_FIELD), "https://spam.example");
		assert.equal(filled.has("honeypot"), false);
	});

	test("a refused or unchecked challenge is a TattooApiError with its code, never retried", async () => {
		const failed = fakeFetch(() =>
			json(403, {
				error: {
					code: "challenge_failed",
					message:
						"We couldn't confirm this request came from a person. Please try again.",
				},
			}),
		);
		const unavailable = fakeFetch(() =>
			json(503, {
				error: {
					code: "challenge_unavailable",
					message: "We couldn't run the security check. Try again in a minute.",
				},
			}),
		);

		const refused = await rejection(
			client(failed.fetch).inquiries.create({
				...input,
				challengeToken: "spent",
			}),
		);
		const unchecked = await rejection(
			client(unavailable.fetch).inquiries.create({
				...input,
				challengeToken: "t",
			}),
		);

		assert.ok(refused instanceof TattooApiError);
		assert.equal(refused.status, 403);
		assert.equal(refused.code, "challenge_failed");
		assert.ok(unchecked instanceof TattooApiError);
		assert.equal(unchecked.status, 503);
		assert.equal(unchecked.code, "challenge_unavailable");
		assert.equal(failed.calls.length, 1);
		assert.equal(unavailable.calls.length, 1);
	});

	test("names the widget's action and the honeypot field for the form", () => {
		assert.equal(INQUIRY_CHALLENGE_ACTION, "inquiry");
		assert.equal(INQUIRY_HONEYPOT_FIELD, "website");
	});
});

describe("deposits", () => {
	const TOKEN = "T".repeat(43);
	const PAGE = {
		studio: { name: "Black Needle" },
		project: { brief: "A fine-line moth", artistName: null },
		deposit: {
			amount: 300_000,
			amountText: "NPR 3,000",
			due: 300_000,
			dueText: "NPR 3,000",
			currency: "NPR",
			payBy: "2026-11-01",
			payByText: "1 Nov 2026",
		},
		referenceCode: "7K3M9Q",
		state: "due",
		lastProofRejected: false,
		proofSubmittedAt: null,
		paymentMethods: [],
		depositPolicy: null,
	};
	const proof = () =>
		new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" });

	test("get reads the token's page under the tenant, without cookies", async () => {
		const { calls, fetch } = fakeFetch(() => json(200, { data: PAGE }));

		const page = await client(fetch).deposits.get(TOKEN);

		assert.deepEqual(page, PAGE);
		assert.equal(
			calls[0].url,
			`https://api.example.com/api/v1/tenants/api-needle-32/deposits/${TOKEN}`,
		);
		assert.equal(calls[0].init.credentials, "omit");
	});

	test("get encodes the token", async () => {
		const { calls, fetch } = fakeFetch(() => json(200, { data: PAGE }));

		await client(fetch).deposits.get("a/b?c");

		assert.match(calls[0].url, /\/deposits\/a%2Fb%3Fc$/);
	});

	test("a link that doesn't work is a 404 TattooApiError", async () => {
		const { fetch } = fakeFetch(() =>
			json(404, { error: { code: "not_found", message: "Not found." } }),
		);

		const error = await rejection(client(fetch).deposits.get(TOKEN));

		assert.ok(error instanceof TattooApiError);
		assert.equal(error.status, 404);
		assert.equal(error.code, "not_found");
	});

	test("submitProof posts one multipart form and returns the new page", async () => {
		const submitted = { ...PAGE, state: "submitted" };
		const { calls, fetch } = fakeFetch(() => json(201, { data: submitted }));

		const page = await client(fetch).deposits.submitProof(TOKEN, {
			proof: proof(),
			method: "esewa",
			expectedAmount: 300_000,
		});

		assert.deepEqual(page, submitted);
		assert.equal(calls[0].init.method, "POST");
		assert.equal(
			calls[0].url,
			`https://api.example.com/api/v1/tenants/api-needle-32/deposits/${TOKEN}`,
		);
		const headers = new Headers(calls[0].init.headers);
		assert.equal(
			headers.has("content-type"),
			false,
			"fetch sets the multipart boundary",
		);
		const form = calls[0].init.body as FormData;
		assert.deepEqual([...form.keys()].sort(), [
			"expectedAmount",
			"method",
			"proof",
		]);
		assert.equal(form.get("method"), "esewa");
		assert.equal(form.get("expectedAmount"), "300000");
		assert.equal((form.get("proof") as File).type, "image/png");
	});

	test("a stale amount is a TattooApiError with deposit_changed", async () => {
		const { fetch } = fakeFetch(() =>
			json(409, {
				error: {
					code: "deposit_changed",
					message:
						"The deposit amount changed. Check the new amount before you upload.",
				},
			}),
		);

		const error = await rejection(
			client(fetch).deposits.submitProof(TOKEN, {
				proof: proof(),
				method: "esewa",
				expectedAmount: 250_000,
			}),
		);

		assert.ok(error instanceof TattooApiError);
		assert.equal(error.status, 409);
		assert.equal(error.code, "deposit_changed");
	});

	test("an upload waits longer than the client's timeout", {
		timeout: 2000,
	}, async () => {
		const { fetch } = fakeFetch(
			() =>
				new Promise<Response>((resolve) =>
					setTimeout(() => resolve(json(201, { data: PAGE })), 60),
				),
		);

		const page = await client(fetch, { timeoutMs: 20 }).deposits.submitProof(
			TOKEN,
			{ proof: proof(), method: "esewa", expectedAmount: 300_000 },
		);

		assert.deepEqual(page, PAGE);
	});
});

describe("studio and artists", () => {
	const STUDIO: Studio = {
		slug: "api-needle-32",
		name: "Black Needle",
		type: "studio",
		intro: "Fine line and blackwork.",
		timezone: "Asia/Kathmandu",
		contact: {
			phone: "+9779812345678",
			email: "hello@black-needle.example",
			address: "Thamel Marg\nKathmandu",
		},
		socialLinks: [
			{ platform: "instagram", url: "https://instagram.com/blackneedle" },
		],
		acceptingInquiries: true,
	};
	const ARTIST: Artist = {
		id: "0199f000-0000-7000-8000-000000000044",
		slug: "sita",
		name: "Sita Rai",
		bio: null,
		photo: {
			url: "https://api.example.com/uploads/tenants/t/artist_photo/p.png",
			width: 300,
			height: 200,
		},
		acceptingInquiries: false,
		closedMessage: "Books open in March.",
	};

	test("studio.get returns the whole profile", async () => {
		const { calls, fetch } = fakeFetch(() => json(200, { data: STUDIO }));

		assert.deepEqual(await client(fetch).studio.get(), STUDIO);
		assert.equal(
			calls[0].url,
			"https://api.example.com/api/v1/tenants/api-needle-32",
		);
	});

	test("artists.list reads the tenant's artists and unwraps the list", async () => {
		const { calls, fetch } = fakeFetch(() => json(200, { data: [ARTIST] }));

		assert.deepEqual(await client(fetch).artists.list(), [ARTIST]);
		assert.equal(
			calls[0].url,
			"https://api.example.com/api/v1/tenants/api-needle-32/artists",
		);
		assert.equal(calls[0].init.credentials, "omit");
	});

	test("artists.get reads one artist by its slug, encoded", async () => {
		const { calls, fetch } = fakeFetch(() => json(200, { data: ARTIST }));

		assert.deepEqual(await client(fetch).artists.get("sita"), ARTIST);
		assert.equal(
			calls[0].url,
			"https://api.example.com/api/v1/tenants/api-needle-32/artists/sita",
		);
		await client(fetch).artists.get("a/b c");
		assert.match(calls[1].url, /\/artists\/a%2Fb%20c$/);
	});

	test("an artist that isn't there is a 404 TattooApiError", async () => {
		const { fetch } = fakeFetch(() =>
			json(404, { error: { code: "not_found", message: "Not found." } }),
		);

		const error = await rejection(client(fetch).artists.get("nobody"));

		assert.ok(error instanceof TattooApiError);
		assert.equal(error.status, 404);
		assert.equal(error.code, "not_found");
	});
});

describe("secret key guard", () => {
	const STUDIO = { slug: "guard-needle-11", name: "Guard Needle" };

	test("a key in a browser is refused", () => {
		assert.throws(
			() =>
				inBrowser(() =>
					createTattooClient({
						baseUrl: "https://api.example.com",
						tenant: "guard-needle-11",
						key: "secret-key-11",
					}),
				),
			/secret keys must never be used in a browser/,
		);
	});

	test("the refusal never carries the key", () => {
		let error: unknown;
		try {
			inBrowser(() =>
				createTattooClient({
					baseUrl: "https://api.example.com",
					tenant: "guard-needle-11",
					key: "secret-key-11",
				}),
			);
		} catch (thrown) {
			error = thrown;
		}

		assert.ok(error instanceof Error);
		assert.ok(!String(error).includes("secret-key-11"));
	});

	test("a client without a key is fine in a browser, and sends no Authorization header", async () => {
		const { calls, fetch } = fakeFetch(() => json(200, { data: STUDIO }));
		const tattoo = inBrowser(() =>
			createTattooClient({
				baseUrl: "https://api.example.com",
				tenant: "guard-needle-11",
				fetch,
			}),
		);

		assert.deepEqual(await tattoo.studio.get(), STUDIO);
		const headers = new Headers(calls[0].init.headers);
		assert.equal(headers.has("authorization"), false);
		assert.equal(headers.get("accept"), "application/json");
	});

	test("on a server the key is sent as a bearer token", async () => {
		const { calls, fetch } = fakeFetch(() => json(200, { data: STUDIO }));

		await createTattooClient({
			baseUrl: "https://api.example.com",
			tenant: "guard-needle-11",
			key: "secret-key-11",
			fetch,
		}).studio.get();

		assert.equal(
			new Headers(calls[0].init.headers).get("authorization"),
			"Bearer secret-key-11",
		);
	});

	test("an empty key is no key", () => {
		assert.doesNotThrow(() =>
			inBrowser(() =>
				createTattooClient({
					baseUrl: "https://api.example.com",
					tenant: "guard-needle-11",
					key: "",
				}),
			),
		);
	});
});

describe("lists with query parameters", () => {
	const T = "https://api.example.com/api/v1/tenants/api-needle-32";
	const SERVICE = {
		id: "0199f000-0000-7000-8000-000000000011",
		name: "Fine line",
		durationMinutes: 90,
	};

	test("services.list() with no query has no question mark", async () => {
		const { calls, fetch } = fakeFetch(() => json(200, { data: [] }));

		assert.deepEqual(await client(fetch).services.list(), []);
		assert.equal(calls[0].url, `${T}/services`);
		assert.equal(calls[0].init.credentials, "omit");
	});

	test("services.list drops undefined values", async () => {
		const { calls, fetch } = fakeFetch(() => json(200, { data: [] }));

		await client(fetch).services.list({ artistId: undefined });
		assert.equal(calls[0].url, `${T}/services`);
		assert.equal(calls[0].init.credentials, "omit");
	});

	test("services.list sends artistId", async () => {
		const { calls, fetch } = fakeFetch(() => json(200, { data: [SERVICE] }));

		assert.deepEqual(await client(fetch).services.list({ artistId: "a1" }), [
			SERVICE,
		]);
		assert.equal(calls[0].url, `${T}/services?artistId=a1`);
		assert.equal(calls[0].init.credentials, "omit");
	});

	test("portfolio.list encodes the query like a form and returns the whole page", async () => {
		const page = { data: [], nextCursor: null };
		const { calls, fetch } = fakeFetch(() => json(200, page));

		const result = await client(fetch).portfolio.list({
			style: "fine line",
			limit: 12,
			cursor: "next page",
		});

		assert.equal(
			calls[0].url,
			`${T}/portfolio?style=fine+line&limit=12&cursor=next+page`,
		);
		assert.equal(calls[0].init.credentials, "omit");
		assert.deepEqual(result, page);
	});

	test("availability.list sends all four parameters in the given order", async () => {
		const slot = {
			startsAt: "2026-11-02T04:00:00Z",
			endsAt: "2026-11-02T05:30:00Z",
		};
		const { calls, fetch } = fakeFetch(() => json(200, { data: [slot] }));

		const slots = await client(fetch).availability.list({
			artistId: "a1",
			serviceId: "s1",
			from: "2026-11-01",
			to: "2026-11-07",
		});

		assert.equal(
			calls[0].url,
			`${T}/availability?artistId=a1&serviceId=s1&from=2026-11-01&to=2026-11-07`,
		);
		assert.equal(calls[0].init.credentials, "omit");
		assert.deepEqual(slots, [slot]);
	});

	test("styles.list and placements.list are not tenant-scoped", async () => {
		const { calls, fetch } = fakeFetch(() => json(200, { data: [] }));
		const tattoo = client(fetch);

		await tattoo.styles.list();
		await tattoo.placements.list();

		assert.equal(calls[0].url, "https://api.example.com/api/v1/styles");
		assert.equal(calls[1].url, "https://api.example.com/api/v1/placements");
		assert.equal(calls[0].init.credentials, "omit");
		assert.equal(calls[1].init.credentials, "omit");
	});

	test("a 404 from a list is a TattooApiError", async () => {
		const { fetch } = fakeFetch(() =>
			json(404, {
				error: { code: "not_found", message: "No such studio." },
			}),
		);

		const error = await rejection(client(fetch).services.list());

		assert.ok(isTattooApiError(error));
		assert.equal(error.status, 404);
		assert.equal(error.code, "not_found");
	});
});
