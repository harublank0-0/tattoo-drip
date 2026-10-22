import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createTattooClient } from "@tattoo-drip/sdk";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProofForm } from "../../src/deposit/components/proof-form.tsx";
import {
	ProofPicker,
	type ProofPickerProps,
} from "../../src/deposit/components/proof-picker.tsx";
import type { DepositMethodKind } from "../../src/deposit/copy.ts";
import { copy } from "../../src/deposit/copy.ts";
import { NO_PROOF, type ProofState } from "../../src/deposit/proof.ts";
import { type DepositView, depositView } from "../../src/deposit/view-model.ts";
import { renderWithProviders } from "../intake/providers.tsx";
import { PAGE, page, TOKEN } from "./fixtures.ts";
import { attr, hrefs, tags, textOf } from "./html.ts";

// @tattoo-drip/react is used from source, and tsx compiles its .tsx files with
// the classic JSX transform (the storefront's tsconfig doesn't cover them),
// which calls the global React.
Object.assign(globalThis, { React });

const file = new File([new Uint8Array(4)], "payment.jpg", {
	type: "image/jpeg",
});

const picker = (overrides: Partial<ProofPickerProps> = {}) =>
	renderToStaticMarkup(
		createElement(ProofPicker, {
			state: NO_PROOF,
			preview: null,
			busy: false,
			error: null,
			onPick: () => undefined,
			onRemove: () => undefined,
			...overrides,
		}),
	);

const fileInput = (html: string) =>
	tags(html, "input").find((tag) => attr(tag, "type") === "file") ?? "";

const formHtml = (
	view: DepositView = depositView(PAGE),
	paidWith: DepositMethodKind | null = null,
) =>
	renderWithProviders(
		createTattooClient({
			baseUrl: "http://api.test",
			tenant: "black-needle-48",
			fetch: () => Promise.reject(new Error("no request during a render")),
		}),
		createElement(ProofForm, {
			token: TOKEN,
			view,
			studioName: "Black Needle",
			paidWith,
			reread: async () => "due" as const,
			onLeftDue: () => undefined,
			onGone: () => undefined,
			onSending: () => undefined,
		}),
	);

describe("ProofPicker", () => {
	test("empty: a fieldset with its hint, one file input for JPEG, PNG or WebP", () => {
		const html = picker();
		assert.match(html, /<fieldset id="proof"/);
		assert.match(html, /<legend[^>]*>Payment screenshot<\/legend>/);
		assert.match(
			html,
			/<p id="proof-hint"[^>]*>A screenshot or a photo of the payment: JPEG, PNG or WebP\.<\/p>/,
		);
		const input = fileInput(html);
		assert.equal(attr(input, "id"), "proof-input");
		assert.equal(attr(input, "accept"), "image/jpeg,image/png,image/webp");
		assert.equal(attr(input, "aria-describedby"), "proof-hint");
		assert.equal(attr(input, "multiple"), undefined);
		assert.equal(attr(input, "aria-disabled"), undefined);
		assert.match(textOf(html), /Add screenshot/);
		assert.doesNotMatch(html, /<img|Remove screenshot/);
	});

	test("preparing: the picker does nothing and says why", () => {
		const html = picker({ state: { kind: "preparing", id: 1 } });
		assert.equal(attr(fileInput(html), "aria-disabled"), "true");
		assert.match(html, /class="deposit-pick deposit-pick-locked"/);
		assert.match(
			html,
			/<p class="deposit-proof-status" aria-live="polite">Preparing your screenshot…<\/p>/,
		);
	});

	test("ready: the preview, another pick, Remove", () => {
		const ready: ProofState = { kind: "ready", id: 1, file };
		const html = picker({ state: ready, preview: "blob:http://x/1" });
		const image = tags(html, "img")[0];
		assert.equal(attr(image, "src"), "blob:http://x/1");
		assert.equal(attr(image, "alt"), "Your payment screenshot");
		assert.match(textOf(html), /Choose another/);
		const remove = tags(html, "button")[0];
		assert.equal(attr(remove, "type"), "button");
		assert.match(textOf(html), /Remove screenshot/);
		assert.match(html, /aria-live="polite">Screenshot added\.<\/p>/);

		const sending = picker({
			state: ready,
			preview: "blob:http://x/1",
			busy: true,
		});
		assert.equal(attr(tags(sending, "button")[0], "aria-disabled"), "true");
		assert.equal(attr(fileInput(sending), "aria-disabled"), "true");
	});

	test("a refused pick says why, naming the file", () => {
		const html = picker({
			state: {
				kind: "empty",
				problem: { kind: "heic", name: "IMG_0042.HEIC" },
			},
		});
		assert.match(
			textOf(html),
			/IMG_0042\.HEIC is a HEIC photo, which this browser can't open\. Take a screenshot of the payment instead\./,
		);
	});

	test("an error is tied to the input", () => {
		const html = picker({ error: copy.form.required.proof });
		const input = fileInput(html);
		assert.equal(attr(input, "aria-invalid"), "true");
		assert.equal(attr(input, "aria-describedby"), "proof-hint proof-error");
		assert.match(
			html,
			/<p id="proof-error"[^>]*>Add a screenshot of your payment\.<\/p>/,
		);
	});
});

describe("ProofForm", () => {
	test("its heading, a no-validate form, both ways to pay, the picker and Send", () => {
		const html = formHtml();
		assert.match(
			html,
			/<h2 id="proof-title" class="deposit-step-title" tabindex="-1"><span class="deposit-step-number" aria-hidden="true">3<\/span><span class="sr-only">Step 3: <\/span>Send the screenshot<\/h2>/,
		);
		const form = tags(html, "form")[0];
		assert.match(form, /novalidate=""/i);
		assert.equal(attr(form, "aria-labelledby"), "proof-title");
		assert.match(html, /<legend[^>]*>How did you pay\?<\/legend>/);
		const radios = tags(html, "input").filter(
			(tag) => attr(tag, "type") === "radio",
		);
		assert.deepEqual(
			radios.map((radio) => [attr(radio, "id"), attr(radio, "value")]),
			[
				["method-0", "esewa"],
				["method-1", "bank"],
			],
		);
		for (const radio of radios) assert.doesNotMatch(radio, / checked=""/);
		assert.match(textOf(html), /eSewa.*Bank transfer/s);
		assert.ok(fileInput(html));
		const send = tags(html, "button").find(
			(tag) => attr(tag, "type") === "submit",
		);
		assert.ok(send);
		assert.equal(attr(send, "aria-disabled"), undefined);
		assert.match(html, />Send screenshot<\/button>/);
		assert.doesNotMatch(html, /role="alert"|proof-summary-title/);
	});

	test("the Pay with pick answers How did you pay?: that kind is checked (TAT-110)", () => {
		const html = formHtml(depositView(PAGE), "bank");
		const radios = tags(html, "input").filter(
			(tag) => attr(tag, "type") === "radio",
		);

		assert.doesNotMatch(radios[0], / checked=""/);
		assert.match(radios[1], / checked=""/);
		// A kind the form doesn't offer is no answer.
		const unknown = tags(formHtml(depositView(PAGE), "khalti"), "input").filter(
			(tag) => attr(tag, "type") === "radio",
		);
		for (const radio of unknown) assert.doesNotMatch(radio, / checked=""/);
	});

	test("the payment screenshot legend is for screen readers only: step 3's heading names the field", () => {
		const html = picker();

		assert.match(
			html,
			/<legend class="deposit-label sr-only">Payment screenshot<\/legend>/,
		);
	});

	test("one way to pay is chosen already", () => {
		const html = formHtml(
			depositView(page({ paymentMethods: [PAGE.paymentMethods[0]] })),
		);
		const radios = tags(html, "input").filter(
			(tag) => attr(tag, "type") === "radio",
		);
		assert.equal(radios.length, 1);
		assert.match(radios[0], / checked=""/);
	});

	test("says when the studio couldn't confirm the last screenshot", () => {
		const html = formHtml(depositView(page({ lastProofRejected: true })));
		assert.ok(textOf(html).includes(copy.rejected));
		assert.ok(!textOf(formHtml()).includes(copy.rejected));
	});

	test("holds no link and never the token", () => {
		const html = formHtml();
		assert.equal(hrefs(html).length, 0);
		assert.ok(!html.includes(TOKEN));
	});
});
