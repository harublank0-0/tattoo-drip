import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { createTattooClient, TattooApiError } from "@tattoo-drip/sdk";
import type { ReviewPage } from "@tattoo-drip/types";
import {
	REVIEW_POLL_GIVE_UP_MS,
	REVIEW_PROCESSING_POLL_MS,
	reviewPollDelay,
	reviewProcessing,
	reviewRefetchInterval,
	reviewRetryDelay,
	tattooKeys,
	tattooMutations,
	tattooQueries,
} from "../src/queries.js";

const TENANT = "review-needle-1";
const TOKEN = "R".repeat(43);
const PAGE: ReviewPage = {
	studio: { name: "Black Needle", onDiscover: false },
	project: { artistName: "Sita", tattooedOn: "2026-10-01" },
	link: { expiresAt: "2027-10-01T00:00:00.000Z" },
	styles: [],
	defaults: { shownName: "Maya G.", styles: [], placement: null },
	review: null,
	post: null,
	blocks: { review: null, post: null },
};

function withVideo(state: "processing" | "ready"): ReviewPage {
	return {
		...PAGE,
		post: {
			status: "draft",
			caption: null,
			styles: [],
			placement: null,
			shownName: "Maya G.",
			consentStudioPage: false,
			consentDiscover: false,
			takenDown: null,
			editable: true,
			media: [
				{
					id: "00000000-0000-4000-8000-000000000001",
					kind: "video",
					state,
					failure: null,
					image: null,
					sources: [],
					durationMs: null,
				},
			],
		},
	};
}

function clientAnswering(status: number, body: unknown) {
	const calls: { url: string; init: RequestInit }[] = [];
	const fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
		calls.push({ url: String(input), init });
		return new Response(JSON.stringify(body), {
			status,
			headers: { "content-type": "application/json" },
		});
	}) as typeof globalThis.fetch;
	return {
		calls,
		client: createTattooClient({
			baseUrl: "https://api.example.com",
			tenant: TENANT,
			fetch,
		}),
	};
}

describe("tattooQueries.review", () => {
	test("its key starts with the tenant; it is always stale and never retries a 4xx", () => {
		const { client } = clientAnswering(200, { data: PAGE });
		const options = tattooQueries.review(client, TOKEN);
		assert.deepEqual(options.queryKey, [
			"tattoo-drip",
			"tenant",
			TENANT,
			"review",
			TOKEN,
		]);
		assert.deepEqual(tattooKeys.review(TENANT, TOKEN), options.queryKey);
		assert.equal(options.staleTime, 0);
		const retry = options.retry as (n: number, e: unknown) => boolean;
		assert.equal(
			retry(0, new TattooApiError(404, { code: "not_found", message: "" })),
			false,
		);
		assert.equal(
			retry(0, new TattooApiError(503, { code: "service_busy", message: "" })),
			true,
		);
		assert.equal(options.retryDelay, reviewRetryDelay);
	});

	test("polls only while a video is processing, with a backoff, and stops after 15 minutes", () => {
		const query = {
			state: { data: withVideo("processing"), error: null as unknown },
		};
		const at = (seconds: number) =>
			reviewRefetchInterval(query, 1_000_000 + seconds * 1000);
		assert.equal(at(0), REVIEW_PROCESSING_POLL_MS);
		assert.equal(at(29), 5_000);
		assert.equal(at(30), 10_000);
		assert.equal(at(90), 20_000);
		assert.equal(at(300), 60_000);
		assert.equal(at(899), 60_000);
		assert.equal(at(900), false, "it gives up after REVIEW_POLL_GIVE_UP_MS");
		assert.equal(REVIEW_POLL_GIVE_UP_MS, 15 * 60_000);
		// Once nothing processes it stops, and a new video starts again at 5 s.
		const done = {
			state: { data: withVideo("ready"), error: null as unknown },
		};
		assert.equal(reviewRefetchInterval(done), false);
		assert.equal(
			reviewRefetchInterval({ state: { data: PAGE, error: null } }),
			false,
		);
		assert.equal(reviewProcessing(undefined), false);
		// One open page reads itself about 35 times in its 15 minutes.
		let reads = 0;
		for (let t = 0; t < REVIEW_POLL_GIVE_UP_MS; ) {
			const wait = reviewPollDelay(t);
			if (wait === false) break;
			t += wait;
			reads++;
		}
		assert.ok(reads <= 40, `${reads} reads`);
	});

	test("never polls after a 4xx, waits Retry-After after a 429, and keeps the backoff after a 5xx", () => {
		const gone = new TattooApiError(404, { code: "not_found", message: "" });
		assert.equal(
			reviewRefetchInterval({
				state: { data: withVideo("processing"), error: gone },
			}),
			false,
		);
		const limited = new TattooApiError(
			429,
			{ code: "rate_limited", message: "" },
			{ retryAfter: 120 },
		);
		assert.equal(
			reviewRefetchInterval({
				state: { data: withVideo("processing"), error: limited },
			}),
			120_000,
		);
		const busy = new TattooApiError(503, { code: "service_busy", message: "" });
		const query = {
			state: { data: withVideo("processing"), error: busy as unknown },
		};
		assert.equal(
			reviewRefetchInterval(query, 0),
			5_000,
			"a 5xx is no fast retry",
		);
		// The query's own retries: none for a 4xx, Retry-After for a 429, slow otherwise.
		const { client } = clientAnswering(200, { data: PAGE });
		const options = tattooQueries.review(client, TOKEN);
		const retry = options.retry as (n: number, e: unknown) => boolean;
		assert.equal(retry(0, gone), false);
		assert.equal(
			retry(0, limited),
			false,
			"a 429 is shown at once, never waited on in loading",
		);
		assert.equal(retry(2, busy), false, "twice at most");
		assert.equal(reviewRetryDelay(0, limited), 120_000);
		assert.deepEqual(
			[0, 1, 2, 3].map((n) => reviewRetryDelay(n, busy)),
			[5_000, 10_000, 20_000, 60_000],
		);
	});
});

describe("tattooMutations review writes", () => {
	test("a write's answer replaces the cached page, and it is never retried", async () => {
		const answer = { ...PAGE, studio: { name: "After", onDiscover: false } };
		const { calls, client } = clientAnswering(200, { data: answer });
		const queryClient = new QueryClient();
		const key = tattooKeys.review(TENANT, TOKEN);
		queryClient.setQueryData(key, PAGE);

		const options = tattooMutations.deleteReview(client, queryClient, TOKEN);
		assert.equal(options.retry, false);
		await new MutationObserver(queryClient, options).mutate();

		assert.deepEqual(queryClient.getQueryData(key), answer);
		assert.equal(calls[0].init.method, "DELETE");
		assert.equal(
			new Headers(calls[0].init.headers).get("X-Review-Token"),
			TOKEN,
		);
	});

	test("submit sends the challenge token in its header", async () => {
		const { calls, client } = clientAnswering(200, { data: PAGE });
		const queryClient = new QueryClient();
		const options = tattooMutations.submitReview(client, queryClient, TOKEN);
		await new MutationObserver(queryClient, options).mutate({
			shownName: "Maya G.",
			consentStudioPage: false,
			consentDiscover: false,
			review: { rating: 4, body: "Lovely work, healed nicely." },
			challengeToken: "turnstile",
		});
		assert.equal(
			new Headers(calls[0].init.headers).get("X-Challenge-Token"),
			"turnstile",
		);
		assert.equal(options.retry, false);
	});
});
