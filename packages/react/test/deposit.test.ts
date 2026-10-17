import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { createTattooClient, TattooApiError } from "@tattoo-drip/sdk";
import type { DepositPage } from "@tattoo-drip/types";
import { tattooKeys, tattooMutations, tattooQueries } from "../src/queries.js";

const TENANT = "deposit-needle-65";
const TOKEN = "T".repeat(43);
const PAGE: DepositPage = {
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

/** A client whose fetch answers every call with `status` and `body`. */
function clientAnswering(status: number, body: unknown) {
	const calls: { url: string; init: RequestInit }[] = [];
	const fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
		calls.push({ url: String(input), init });
		return new Response(JSON.stringify(body), {
			status,
			headers: { "content-type": "application/json" },
		});
	}) as typeof globalThis.fetch;
	const client = createTattooClient({
		baseUrl: "https://api.example.com",
		tenant: TENANT,
		fetch,
	});
	return { calls, client };
}

describe("tattooQueries.deposit", () => {
	test("its key starts with the tenant and ends with the token", () => {
		const { client } = clientAnswering(200, { data: PAGE });
		const key = ["tattoo-drip", "tenant", TENANT, "deposit", TOKEN];

		assert.deepEqual(tattooQueries.deposit(client, TOKEN).queryKey, key);
		assert.deepEqual(tattooKeys.deposit(TENANT, TOKEN), key);
	});

	test("it loads the page through the SDK", async () => {
		const { calls, client } = clientAnswering(200, { data: PAGE });

		const page = await new QueryClient().fetchQuery(
			tattooQueries.deposit(client, TOKEN),
		);

		assert.deepEqual(page, PAGE);
		assert.equal(
			calls[0].url,
			`https://api.example.com/api/v1/tenants/${TENANT}/deposits/${TOKEN}`,
		);
	});

	test("a 4xx is not retried; a network error is, up to 3 times", () => {
		const { client } = clientAnswering(200, { data: PAGE });
		const retry = tattooQueries.deposit(client, TOKEN).retry as (
			failures: number,
			error: unknown,
		) => boolean;
		const offline = new TattooApiError(0, {
			code: "network_error",
			message: "The Tattoo Drip API could not be reached.",
		});

		assert.equal(
			retry(
				0,
				new TattooApiError(404, { code: "not_found", message: "Not found." }),
			),
			false,
		);
		assert.equal(
			retry(
				0,
				new TattooApiError(429, {
					code: "rate_limited",
					message: "Slow down.",
				}),
			),
			false,
		);
		assert.equal(retry(0, offline), true);
		assert.equal(retry(2, offline), true);
		assert.equal(retry(3, offline), false);
	});
});

describe("tattooMutations.submitDepositProof", () => {
	const input = {
		proof: new Blob([new Uint8Array([0x89, 0x50])], { type: "image/png" }),
		method: "esewa" as const,
		expectedAmount: 300_000,
	};

	test("posts the proof, is never retried, and puts the answer in the deposit query", async () => {
		const answered: DepositPage = { ...PAGE, state: "submitted" };
		const { calls, client } = clientAnswering(201, { data: answered });
		const queryClient = new QueryClient();
		const options = tattooMutations.submitDepositProof(
			client,
			queryClient,
			TOKEN,
		);

		const page = await new MutationObserver(queryClient, options).mutate(input);

		assert.equal(options.retry, false);
		assert.deepEqual(page, answered);
		assert.equal(calls.length, 1);
		assert.equal(calls[0].init.method, "POST");
		assert.deepEqual(
			queryClient.getQueryData(tattooKeys.deposit(TENANT, TOKEN)),
			answered,
		);
	});

	test("a failed upload is sent once, even when the QueryClient retries every mutation", async () => {
		const { calls, client } = clientAnswering(500, {
			error: { code: "internal_error", message: "Something went wrong." },
		});
		const queryClient = new QueryClient({
			defaultOptions: { mutations: { retry: 3, retryDelay: 0 } },
		});
		const observer = new MutationObserver(
			queryClient,
			tattooMutations.submitDepositProof(client, queryClient, TOKEN),
		);

		await assert.rejects(observer.mutate(input), TattooApiError);

		assert.equal(calls.length, 1);
		assert.equal(
			queryClient.getQueryData(tattooKeys.deposit(TENANT, TOKEN)),
			undefined,
		);
	});
});
