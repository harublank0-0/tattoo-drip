import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { createTattooClient, TattooApiError } from "@tattoo-drip/sdk";
import type { ReviewPage } from "@tattoo-drip/types";
import {
	REVIEW_PROCESSING_POLL_MS,
	reviewProcessing,
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
	});

	test("polls only while a video is processing", () => {
		const { client } = clientAnswering(200, { data: PAGE });
		const options = tattooQueries.review(client, TOKEN);
		const interval = options.refetchInterval as (query: {
			state: { data: ReviewPage | undefined };
		}) => number | false;
		assert.equal(
			interval({ state: { data: withVideo("processing") } }),
			REVIEW_PROCESSING_POLL_MS,
		);
		assert.equal(interval({ state: { data: withVideo("ready") } }), false);
		assert.equal(interval({ state: { data: PAGE } }), false);
		assert.equal(reviewProcessing(undefined), false);
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
