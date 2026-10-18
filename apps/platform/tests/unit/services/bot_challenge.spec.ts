import { mock } from "node:test";
import { Secret } from "@adonisjs/core/helpers";
import logger from "@adonisjs/core/services/logger";
import { test } from "@japa/runner";
import BotChallenge, {
	CHALLENGE_ACTIONS,
	SITEVERIFY_URL,
} from "#services/bot_challenge";

const SECRET = "0x4AAAAAAAunit-secret-55";
const TOKEN = "0.unit-token-55";
const HOST = "intake-guard-55.localhost";
const EXPECTED = { hostname: HOST, action: CHALLENGE_ACTIONS.inquiry };

type Call = { url: string; init: RequestInit; form: URLSearchParams };

/** A fetch that records each call (with its form) and answers with `answer`. */
function fakeFetch(answer: (call: Call) => Response | Promise<Response>) {
	const calls: Call[] = [];
	const fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
		const call = {
			url: String(input),
			init,
			form: new URLSearchParams(String(init.body)),
		};
		calls.push(call);
		return answer(call);
	};
	return { calls, fetch: fetch as typeof globalThis.fetch };
}

/** Cloudflare's verdict for a good token made on HOST's page, with changes. */
function verdict(over: Record<string, unknown> = {}) {
	return Response.json({
		success: true,
		"error-codes": [],
		challenge_ts: "2026-10-18T10:00:00.000Z",
		hostname: HOST,
		action: CHALLENGE_ACTIONS.inquiry,
		...over,
	});
}

function challenge(
	fetch: typeof globalThis.fetch,
	options: { strict?: boolean; timeoutMs?: number } = {},
) {
	return new BotChallenge({
		secret: new Secret(SECRET),
		fetch,
		strict: true,
		timeoutMs: 50,
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

/** Silences warn and error and keeps what they were given. */
function captureLogs() {
	const warn = mock.method(logger, "warn", () => {});
	const error = mock.method(logger, "error", () => {});
	return {
		warnings: () => warn.mock.calls.map((call) => call.arguments),
		errors: () => error.mock.calls.map((call) => call.arguments),
		restore: () => {
			warn.mock.restore();
			error.mock.restore();
		},
	};
}

test.group("BotChallenge", () => {
	test("off without a secret: everything passes and Cloudflare is never asked", async ({
		assert,
	}) => {
		const { calls, fetch } = fakeFetch(() => verdict());
		const off = new BotChallenge({ secret: undefined, fetch });

		assert.equal(await off.verify(undefined, EXPECTED), "passed");
		assert.equal(await off.verify("anything", EXPECTED), "passed");
		assert.lengthOf(calls, 0);
		// The default instance in tests reads .env.test's empty secret.
		assert.equal(
			await new BotChallenge().verify(undefined, EXPECTED),
			"passed",
		);
	});

	test("sends the secret and the token, form-encoded, to siteverify, and nothing else", async ({
		assert,
	}) => {
		const { calls, fetch } = fakeFetch(() => verdict());

		await challenge(fetch).verify(TOKEN, EXPECTED);

		assert.lengthOf(calls, 1);
		assert.equal(calls[0].url, SITEVERIFY_URL);
		assert.equal(calls[0].init.method, "POST");
		assert.instanceOf(calls[0].init.body, URLSearchParams);
		assert.deepEqual([...calls[0].form.keys()].sort(), ["response", "secret"]);
		assert.equal(calls[0].form.get("secret"), SECRET);
		assert.equal(calls[0].form.get("response"), TOKEN);
		assert.instanceOf(calls[0].init.signal, AbortSignal);
	});

	test("a good token for this studio page passes, whatever the host's letter case", async ({
		assert,
	}) => {
		for (const hostname of [HOST, "Intake-Guard-55.LOCALHOST"]) {
			const { fetch } = fakeFetch(() => verdict({ hostname }));
			assert.equal(await challenge(fetch).verify(TOKEN, EXPECTED), "passed");
		}
	});

	test("Cloudflare's refusals fail: invalid, expired or used twice, missing, malformed", async ({
		assert,
	}) => {
		for (const codes of [
			["invalid-input-response"],
			["timeout-or-duplicate"],
			["missing-input-response"],
			["bad-request"],
			[],
		]) {
			const { fetch } = fakeFetch(() =>
				verdict({ success: false, "error-codes": codes }),
			);
			assert.equal(
				await challenge(fetch).verify(TOKEN, EXPECTED),
				"failed",
				codes.join(),
			);
		}
	});

	test("a token from another page or for another form fails", async ({
		assert,
	}) => {
		for (const over of [
			{ hostname: "intake-other-55.localhost" },
			{ hostname: `${HOST}.evil.example` },
			{ hostname: undefined },
			{ hostname: null },
			{ action: "signup" },
			{ action: undefined },
		]) {
			const { fetch } = fakeFetch(() => verdict(over));
			assert.equal(
				await challenge(fetch).verify(TOKEN, EXPECTED),
				"failed",
				JSON.stringify(over),
			);
		}
	});

	test("outside production only success counts, so Cloudflare's test keys work locally", async ({
		assert,
	}) => {
		const other = fakeFetch(() =>
			verdict({ hostname: "example.com", action: "" }),
		);
		const refused = fakeFetch(() =>
			verdict({ success: false, "error-codes": ["invalid-input-response"] }),
		);

		assert.equal(
			await challenge(other.fetch, { strict: false }).verify(TOKEN, EXPECTED),
			"passed",
		);
		assert.equal(
			await challenge(refused.fetch, { strict: false }).verify(TOKEN, EXPECTED),
			"failed",
		);
	});

	test("no token, a blank one or one over 2048 characters fails without a call", async ({
		assert,
	}) => {
		const { calls, fetch } = fakeFetch(() => verdict());

		for (const token of [undefined, "", "   ", "t".repeat(2049)]) {
			assert.equal(
				await challenge(fetch).verify(token, EXPECTED),
				"failed",
				String(token?.length),
			);
		}
		assert.lengthOf(calls, 0);
		assert.equal(
			await challenge(fetch).verify("t".repeat(2048), EXPECTED),
			"passed",
		);
		assert.lengthOf(calls, 1);
	});

	test("an answer that isn't a verdict, an error status, a timeout or a network error is unavailable", async ({
		assert,
	}) => {
		const logs = captureLogs();
		try {
			const answers: Record<
				string,
				(call: Call) => Response | Promise<Response>
			> = {
				"a 500": () => Response.json({ success: true }, { status: 500 }),
				"a 502 page": () => new Response("<html>", { status: 502 }),
				"not JSON": () => new Response("<html>", { status: 200 }),
				"success as a string": () => Response.json({ success: "true" }),
				"an array": () => Response.json([]),
				"error-codes not a list": () =>
					Response.json({ success: false, "error-codes": "bad" }),
				"a hostname that isn't a string": () => verdict({ hostname: 5 }),
				"no answer in time": hangUntilAborted,
				"a network error": () => Promise.reject(new TypeError("fetch failed")),
			};
			for (const [why, answer] of Object.entries(answers)) {
				const { fetch } = fakeFetch(answer);
				const started = Date.now();
				assert.equal(
					await challenge(fetch).verify(TOKEN, EXPECTED),
					"unavailable",
					why,
				);
				assert.isBelow(Date.now() - started, 1000, why);
			}
			assert.lengthOf(logs.warnings(), Object.keys(answers).length);
		} finally {
			logs.restore();
		}
	});

	test("Cloudflare's own error is unavailable, and a refused secret is logged as an error", async ({
		assert,
	}) => {
		const logs = captureLogs();
		try {
			for (const [codes, outcome] of [
				[["internal-error"], "unavailable"],
				[["invalid-input-secret"], "unavailable"],
				[["missing-input-secret"], "unavailable"],
			] as const) {
				const { fetch } = fakeFetch(() =>
					verdict({ success: false, "error-codes": codes }),
				);
				assert.equal(
					await challenge(fetch).verify(TOKEN, EXPECTED),
					outcome,
					codes.join(),
				);
			}
			assert.deepEqual(logs.errors(), [
				["Bot challenge: Cloudflare refused TURNSTILE_SECRET_KEY"],
				["Bot challenge: Cloudflare refused TURNSTILE_SECRET_KEY"],
			]);
			assert.lengthOf(logs.warnings(), 1);
		} finally {
			logs.restore();
		}
	});

	test("no log line holds the token, the secret or Cloudflare's body", async ({
		assert,
	}) => {
		const logs = captureLogs();
		const BODY = "cloudflare-body-55";
		try {
			for (const answer of [
				() => new Response(BODY, { status: 500 }),
				() => new Response(BODY, { status: 200 }),
				() =>
					verdict({
						success: false,
						"error-codes": ["internal-error"],
						messages: [BODY],
					}),
				() =>
					verdict({ success: false, "error-codes": ["invalid-input-secret"] }),
				() => Promise.reject(new TypeError(`fetch failed ${BODY}`)),
			]) {
				await challenge(fakeFetch(answer).fetch).verify(TOKEN, EXPECTED);
			}
			const logged = JSON.stringify([...logs.warnings(), ...logs.errors()]);
			assert.notInclude(logged, TOKEN);
			assert.notInclude(logged, SECRET);
			assert.notInclude(logged, BODY);
			for (const [, message] of logs.warnings()) {
				assert.equal(message, "Bot challenge check unavailable");
			}
		} finally {
			logs.restore();
		}
	});
});
