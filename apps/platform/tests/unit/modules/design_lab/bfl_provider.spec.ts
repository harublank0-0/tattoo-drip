import { test } from "@japa/runner";
import BflProvider, {
	MAX_DOWNLOAD_BYTES,
	registrableDomain,
} from "#modules/design_lab/providers/bfl_provider";
import { DesignProviderError } from "#modules/design_lab/providers/types";

type Call = { url: string; init: RequestInit };

/** A stand-in for fetch: records each call and answers from `answers`, first first. No network. */
function stubFetch(answers: (Response | Error)[]) {
	const calls: Call[] = [];
	const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
		calls.push({ url: String(input), init: init ?? {} });
		const next = answers.shift();
		if (!next) throw new Error("no answer left");
		if (next instanceof Error) throw next;
		return next;
	}) as typeof fetch;
	return { calls, fetcher };
}

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});

const provider = (fetcher: typeof fetch, model = "flux-model-x") =>
	new BflProvider({
		apiKey: "test-key-123456",
		apiUrl: "https://api.bfl.ai",
		model,
		fetch: fetcher,
	});

const request = {
	prompt: "Original tattoo design concept artwork",
	orientation: "portrait" as const,
	width: 832,
	height: 1216,
	aspectRatio: "2:3",
};

async function rejection(promise: Promise<unknown>) {
	try {
		await promise;
	} catch (error) {
		return error as DesignProviderError;
	}
	throw new Error("expected a rejection");
}

test.group("BFL provider", () => {
	test("a submit posts to the configured model with the key header and keeps the returned polling URL", async ({
		assert,
	}) => {
		const { calls, fetcher } = stubFetch([
			json({
				id: "req-1",
				polling_url: "https://api.us1.bfl.ai/v1/get_result?id=req-1",
				cost: 3.5,
			}),
		]);
		const submitted = await provider(fetcher).submit(request);
		assert.deepEqual(submitted, {
			requestId: "req-1",
			pollingUrl: "https://api.us1.bfl.ai/v1/get_result?id=req-1",
			cost: 3.5,
		});
		assert.equal(calls[0].url, "https://api.bfl.ai/v1/flux-model-x");
		assert.equal(calls[0].init.method, "POST");
		const headers = calls[0].init.headers as Record<string, string>;
		assert.equal(headers["x-key"], "test-key-123456");
		assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
			prompt: request.prompt,
			output_format: "png",
			safety_tolerance: 2,
			width: 832,
			height: 1216,
		});
	});

	test("models sized by aspect ratio get aspect_ratio", async ({ assert }) => {
		const { calls, fetcher } = stubFetch([
			json({ id: "r", polling_url: "https://api.bfl.ai/v1/get_result?id=r" }),
		]);
		await provider(fetcher, "flux-pro-1.1-ultra").submit(request);
		const body = JSON.parse(String(calls[0].init.body));
		assert.equal(body.aspect_ratio, "2:3");
		assert.notProperty(body, "width");
	});

	test("a polling URL off BFL's domain is refused, so the key never leaves it", async ({
		assert,
	}) => {
		for (const pollingUrl of [
			"https://evil.example/v1/get_result?id=r",
			"http://api.bfl.ai.evil.example/x",
			"https://user:pass@api.bfl.ai/x",
			"http://api.eu.bfl.ai/x",
		]) {
			const { fetcher } = stubFetch([
				json({ id: "r", polling_url: pollingUrl }),
			]);
			const error = await rejection(provider(fetcher).submit(request));
			assert.instanceOf(error, DesignProviderError);
			assert.equal(error.kind, "uncertain");
		}
		const { calls, fetcher } = stubFetch([]);
		const error = await rejection(
			provider(fetcher).poll("https://evil.example/v1/get_result?id=r"),
		);
		assert.equal(error.kind, "invalid_response");
		assert.lengthOf(calls, 0);
	});

	test("HTTP refusals and silences are sorted by what the worker may do", async ({
		assert,
	}) => {
		const cases: [Response | Error, string][] = [
			[json({ detail: "busy" }, 429), "rate_limited"],
			[json({ detail: "credits" }, 402), "credits"],
			[json({ detail: "Not authenticated" }, 403), "auth"],
			[json({ detail: "bad" }, 422), "rejected"],
			// A server error may come after the task was made: never resubmitted.
			[json({ detail: "oops" }, 500), "uncertain"],
			[json({ detail: "gateway" }, 502), "uncertain"],
			[json({ detail: "busy" }, 503), "unavailable"],
			[json({ detail: "no such model" }, 404), "config"],
			[new TypeError("fetch failed"), "uncertain"],
			[new Response("not json", { status: 200 }), "uncertain"],
		];
		for (const [answer, kind] of cases) {
			const { fetcher } = stubFetch([answer]);
			const error = await rejection(provider(fetcher).submit(request));
			assert.equal(error.kind, kind, `for ${kind}`);
			assert.notInclude(error.message, request.prompt);
		}
	});

	test("poll statuses map to results", async ({ assert }) => {
		const url = "https://api.us1.bfl.ai/v1/get_result?id=r";
		const { calls, fetcher } = stubFetch([
			json({ status: "Pending" }),
			json({
				status: "Ready",
				result: { sample: "https://delivery-us1.bfl.ai/r/sample.png", seed: 7 },
			}),
			json({ status: "Request Moderated" }),
			json({ status: "Content Moderated" }),
			json({ status: "Error" }),
			json({ status: "Task not found" }),
			json({
				status: "Ready",
				result: { sample: "https://cdn.example/x.png" },
			}),
		]);
		const bfl = provider(fetcher);
		assert.deepEqual(await bfl.poll(url), {
			state: "pending",
			providerStatus: "Pending",
		});
		assert.deepEqual(await bfl.poll(url), {
			state: "ready",
			sampleUrl: "https://delivery-us1.bfl.ai/r/sample.png",
			seed: 7,
		});
		assert.deepEqual(await bfl.poll(url), {
			state: "moderated",
			code: "request_moderated",
		});
		assert.deepEqual(await bfl.poll(url), {
			state: "moderated",
			code: "content_moderated",
		});
		assert.deepEqual(await bfl.poll(url), {
			state: "error",
			providerStatus: "Error",
		});
		assert.deepEqual(await bfl.poll(url), { state: "not_found" });
		assert.equal((await rejection(bfl.poll(url))).kind, "invalid_response");
		assert.equal(calls[0].url, url);
		assert.equal(
			(calls[0].init.headers as Record<string, string>)["x-key"],
			"test-key-123456",
		);
	});

	test("a download sends no key and refuses non-images and oversized files", async ({
		assert,
	}) => {
		const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
		const { calls, fetcher } = stubFetch([
			new Response(png, { headers: { "content-type": "image/png" } }),
			new Response("<html>", { headers: { "content-type": "text/html" } }),
			new Response("x", {
				headers: {
					"content-type": "image/png",
					"content-length": String(MAX_DOWNLOAD_BYTES + 1),
				},
			}),
		]);
		const bfl = provider(fetcher);
		const sample = "https://delivery-eu1.bfl.ai/r/sample.png";
		assert.deepEqual(await bfl.download(sample), png);
		assert.isUndefined(calls[0].init.headers);
		assert.equal(
			(await rejection(bfl.download(sample))).kind,
			"invalid_response",
		);
		assert.equal(
			(await rejection(bfl.download(sample))).kind,
			"invalid_response",
		);
		assert.equal(registrableDomain("api.eu.bfl.ai"), "bfl.ai");
	});
});
