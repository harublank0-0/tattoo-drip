import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MutationObserver, onlineManager } from "@tanstack/react-query";
import { tattooMutations } from "@tattoo-drip/react";
import {
	type CreateInquiryInput,
	createTattooClient,
	type InquiryReceipt,
} from "@tattoo-drip/sdk";
import { createStorefrontQueryClient } from "../../src/api/query-client.ts";
import type { ChallengeResult } from "../../src/intake/challenge.ts";
import { describeSubmitError } from "../../src/intake/problems.ts";
import {
	createSubmitter,
	type SubmitPhase,
} from "../../src/intake/submit-flow.ts";

const INPUT: CreateInquiryInput = {
	idea: "A peony",
	placement: "Forearm",
	approximateSize: "10 cm",
	preferredDates: "November",
	sourceChannel: "instagram",
	contactName: "Asha",
	contactPhone: "9812345678",
	honeypot: "",
};
const RECEIPT: InquiryReceipt = { id: "0199f000-0000-7000-8000-000000000057" };

function setup(
	options: {
		token?: ChallengeResult | null;
		send?: () => Promise<InquiryReceipt>;
	} = {},
) {
	const sent: CreateInquiryInput[] = [];
	const phases: SubmitPhase[] = [];
	const events: string[] = [];
	const challenge =
		options.token === null
			? null
			: {
					token: async () => {
						events.push("token");
						return options.token ?? { ok: true as const, token: "tok-57" };
					},
					reset: () => events.push("reset"),
				};
	const submit = createSubmitter({
		challenge,
		send: async (input) => {
			events.push("send");
			sent.push(input);
			return options.send ? options.send() : RECEIPT;
		},
		onPhase: (phase) => phases.push(phase),
	});
	return { submit, sent, phases, events };
}

describe("createSubmitter", () => {
	test("checks, sends with the token, then resets the widget", async () => {
		const { submit, sent, phases, events } = setup();

		assert.deepEqual(await submit(INPUT), { kind: "sent", receipt: RECEIPT });
		assert.equal(sent[0].challengeToken, "tok-57");
		assert.deepEqual(phases, ["checking", "sending"]);
		assert.deepEqual(events, ["token", "send", "reset"]);
	});

	test("a refused send still resets the widget, and says why", async () => {
		const failure = new Error("refused");
		const { submit, events } = setup({ send: () => Promise.reject(failure) });

		assert.deepEqual(await submit(INPUT), { kind: "failed", error: failure });
		assert.deepEqual(events, ["token", "send", "reset"]);
	});

	test("no token, no send: the widget is reset for the next try", async () => {
		const { submit, sent, events, phases } = setup({
			token: { ok: false, reason: "expired" },
		});

		assert.deepEqual(await submit(INPUT), {
			kind: "challenge",
			reason: "expired",
		});
		assert.equal(sent.length, 0);
		assert.deepEqual(events, ["token", "reset"]);
		assert.deepEqual(phases, ["checking"]);
	});

	test("without a site key (development) it sends with no token", async () => {
		const { submit, sent, phases } = setup({ token: null });

		assert.deepEqual(await submit(INPUT), { kind: "sent", receipt: RECEIPT });
		assert.equal(sent[0].challengeToken, undefined);
		assert.deepEqual(phases, ["sending"]);
	});

	test("a second tap while one attempt runs is busy, and sends nothing", async () => {
		let finish: (receipt: InquiryReceipt) => void = () => {};
		const { submit, sent } = setup({
			send: () =>
				new Promise((done) => {
					finish = done;
				}),
		});
		const first = submit(INPUT);

		assert.deepEqual(await submit(INPUT), { kind: "busy" });
		await new Promise((done) => setImmediate(done));
		finish(RECEIPT);
		assert.deepEqual(await first, { kind: "sent", receipt: RECEIPT });
		assert.equal(sent.length, 1);

		const again = submit(INPUT);
		await new Promise((done) => setImmediate(done));
		finish(RECEIPT);
		assert.deepEqual(
			await again,
			{ kind: "sent", receipt: RECEIPT },
			"free again after",
		);
		assert.equal(sent.length, 2);
	});

	test("a check that throws is a blocked check: no send, the widget reset", async () => {
		const events: string[] = [];
		const phases: SubmitPhase[] = [];
		const submit = createSubmitter({
			challenge: {
				token: () => Promise.reject(new TypeError("render is not a function")),
				reset: () => events.push("reset"),
			},
			send: async () => {
				events.push("send");
				return RECEIPT;
			},
			onPhase: (phase) => phases.push(phase),
		});

		assert.deepEqual(await submit(INPUT), {
			kind: "challenge",
			reason: "blocked",
		});
		assert.deepEqual(events, ["reset"]);
		assert.deepEqual(phases, ["checking"]);
		assert.deepEqual(
			await submit(INPUT),
			{ kind: "challenge", reason: "blocked" },
			"free to try again",
		);
	});

	test("a widget that throws when reset doesn't hide the answer", async () => {
		const failure = new Error("refused");
		for (const [send, expected] of [
			[async () => RECEIPT, { kind: "sent", receipt: RECEIPT }],
			[() => Promise.reject(failure), { kind: "failed", error: failure }],
		] as const) {
			const submit = createSubmitter({
				challenge: {
					token: async () => ({ ok: true, token: "tok-57" }),
					reset: () => {
						throw new Error("the widget is gone");
					},
				},
				send,
				onPhase: () => {},
			});

			assert.deepEqual(await submit(INPUT), expected);
		}

		const noToken = createSubmitter({
			challenge: {
				token: async () => ({ ok: false, reason: "expired" }),
				reset: () => {
					throw new Error("the widget is gone");
				},
			},
			send: async () => RECEIPT,
			onPhase: () => {},
		});
		assert.deepEqual(await noToken(INPUT), {
			kind: "challenge",
			reason: "expired",
		});
	});

	test("never changes the input it was given", async () => {
		const { submit } = setup();
		const input = { ...INPUT };
		await submit(input);

		assert.deepEqual(input, INPUT);
	});
});

describe("a send while the browser is offline", () => {
	test("fails at once into the offline notice, and the widget is reset", async () => {
		// The real mutation (useCreateInquiry's options) in the storefront's real
		// QueryClient, with the browser offline after the token was taken.
		const queryClient = createStorefrontQueryClient("browser");
		const client = createTattooClient({
			baseUrl: "http://api.test",
			tenant: "black-needle-57",
			fetch: () => Promise.reject(new TypeError("Failed to fetch")),
		});
		const mutation = new MutationObserver(
			queryClient,
			tattooMutations.createInquiry(client),
		);
		const events: string[] = [];
		const submit = createSubmitter({
			challenge: {
				token: async () => {
					events.push("token");
					return { ok: true, token: "tok-57" };
				},
				reset: () => events.push("reset"),
			},
			send: (input) => {
				events.push("send");
				return mutation.mutate(input);
			},
			onPhase: () => {},
		});

		onlineManager.setOnline(false);
		try {
			const result = await Promise.race([
				submit(INPUT),
				new Promise<"still waiting">((done) =>
					setImmediate(() => setImmediate(() => done("still waiting"))),
				),
			]);

			assert.notEqual(result, "still waiting", "the send was paused");
			assert.equal((result as { kind: string }).kind, "failed");
			const problem = describeSubmitError(
				(result as { error: unknown }).error,
				{ sentArtistId: null, artistName: () => null },
			);
			assert.equal(problem.kind, "notice");
			assert.equal(problem.kind === "notice" && problem.code, "offline");
			assert.equal(problem.kind === "notice" && problem.retry, true);
			assert.deepEqual(events, ["token", "send", "reset"]);
		} finally {
			onlineManager.setOnline(true);
		}
	});
});
