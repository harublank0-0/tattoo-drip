import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import type { CreateInquiryInput, TattooClient } from "@tattoo-drip/sdk";
import { tattooMutations } from "../src/queries.js";

const input = {
	idea: "A peony",
	placement: "Forearm",
	approximateSize: "10 cm",
	preferredDates: "November",
	sourceChannel: "instagram",
	contactName: "Maya",
	contactPhone: "9812345678",
} as CreateInquiryInput;

/** A client whose inquiries.create runs `create` and counts its calls. */
function fakeClient(create: (input: CreateInquiryInput) => Promise<unknown>) {
	const calls: CreateInquiryInput[] = [];
	const client = {
		tenant: "needle",
		inquiries: {
			create: (sent: CreateInquiryInput) => {
				calls.push(sent);
				return create(sent);
			},
		},
	} as unknown as TattooClient;
	return { client, calls };
}

describe("tattooMutations.createInquiry", () => {
	test("sets retry: false itself", () => {
		const { client } = fakeClient(async () => ({ id: "1" }));

		assert.equal(tattooMutations.createInquiry(client).retry, false);
	});

	test("sends the input through client.inquiries.create", async () => {
		const { client, calls } = fakeClient(async () => ({ id: "inq-1" }));
		const options = tattooMutations.createInquiry(client);

		const receipt = await options.mutationFn?.(input, {} as never);

		assert.deepEqual(receipt, { id: "inq-1" });
		assert.deepEqual(calls, [input]);
	});

	test("is sent once even when the QueryClient retries every mutation", async () => {
		const { client, calls } = fakeClient(async () => {
			throw new Error("timed out");
		});
		const queryClient = new QueryClient({
			defaultOptions: { mutations: { retry: 3, retryDelay: 0 } },
		});
		const observer = new MutationObserver(
			queryClient,
			tattooMutations.createInquiry(client),
		);

		await assert.rejects(observer.mutate(input), /timed out/);

		assert.equal(calls.length, 1);
	});
});
