import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { CreateInquiryInput, InquiryReceipt } from "@tattoo-drip/sdk";
import type { ChallengeResult } from "../../src/intake/challenge.ts";
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

	test("never changes the input it was given", async () => {
		const { submit } = setup();
		const input = { ...INPUT };
		await submit(input);

		assert.deepEqual(input, INPUT);
	});
});
