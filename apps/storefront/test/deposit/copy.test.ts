import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { copy, PROOF_NOTICE_CODES } from "../../src/deposit/copy.ts";
import { headCopy } from "../../src/deposit/head-copy.ts";
import { PHOTO_PROBLEMS } from "../../src/intake/copy.ts";

/** The placeholders the page fills somewhere. */
const PLACEHOLDERS = new Set([
	"studio",
	"artist",
	"amount",
	"date",
	"count",
	"code",
	"label",
	"number",
	"name",
	"wait",
]);

/** Every string in the copy, with its path. */
function strings(value: unknown, path = "copy"): Array<[string, string]> {
	if (typeof value === "string") return [[path, value]];
	if (typeof value === "object" && value !== null) {
		return Object.entries(value).flatMap(([key, child]) =>
			strings(child, `${path}.${key}`),
		);
	}
	return [];
}

describe("the deposit page's copy", () => {
	test("uses only the placeholders the page fills, and no stray braces", () => {
		for (const [path, text] of strings(copy)) {
			for (const match of text.matchAll(/\{(\w+)\}/g)) {
				assert.ok(PLACEHOLDERS.has(match[1]), `${path}: {${match[1]}}`);
			}
			assert.doesNotMatch(text.replace(/\{\w+\}/g, ""), /[{}]/, path);
		}
	});

	test("has no empty string", () => {
		for (const [path, text] of strings(copy)) {
			assert.ok(text.trim().length > 0, path);
		}
	});

	test("explains every refusal and names the file in every screenshot problem", () => {
		for (const code of PROOF_NOTICE_CODES) {
			assert.ok(copy.notices[code].title.length > 0, code);
		}
		for (const problem of PHOTO_PROBLEMS) {
			assert.match(copy.form.problems[problem], /\{name\}/, problem);
		}
	});

	test("names every kind of payment method, its scan hint and its number", () => {
		for (const kind of ["fonepay", "esewa", "khalti", "bank"] as const) {
			assert.ok(copy.form.kinds[kind], kind);
			assert.ok(copy.methods.scan[kind], kind);
			assert.ok(copy.methods.accountNumber[kind], kind);
		}
	});

	test("keeps the TAT-65 spec's words", () => {
		assert.equal(copy.heading, "Pay your deposit to {studio}");
		assert.equal(
			copy.due.partial,
			"Part of your {amount} deposit was already received.",
		);
		assert.equal(
			copy.code.hint,
			"Write this code in the payment remark (or note).",
		);
		assert.equal(
			copy.methods.none,
			"The studio hasn't added payment details yet. Message them to ask how to pay.",
		);
		assert.equal(copy.policyTitle, "Deposit policy");
		assert.equal(
			copy.rejected,
			"The studio couldn't confirm your last screenshot. Check the amount and the reference code, then send a new one, or message the studio.",
		);
		assert.equal(copy.form.title, "After you pay, send a screenshot");
		assert.equal(copy.form.method, "How did you pay?");
		assert.equal(copy.form.proof, "Payment screenshot");
		assert.equal(copy.form.send, "Send screenshot");
		assert.equal(copy.form.sending, "Sending…");
		assert.equal(
			copy.form.tooLarge,
			"This image is too large. Use one of 10 MB or less.",
		);
		assert.equal(
			copy.notices.changed.title,
			"The deposit amount changed. Check the new amount.",
		);
		assert.equal(
			copy.notices["rate-limited"].title,
			"Too many tries. Wait {wait} and try again.",
		);
		assert.equal(
			copy.notices.offline.title,
			"Couldn't send. Check your connection and try again.",
		);
		assert.equal(
			copy.states.submitted,
			"We've sent your screenshot to {studio}, received {date}. They'll check it and confirm on WhatsApp or Viber.",
		);
		assert.equal(copy.states.paid, "Your deposit is paid. Thank you!");
		assert.equal(
			copy.states.paidNone,
			"No deposit is needed for this booking.",
		);
		assert.equal(
			copy.states.updating,
			"{studio} is updating your quote. They'll message you when it's ready.",
		);
		assert.equal(
			copy.states.expired,
			"This quote has expired. Message {studio} if you still want to book.",
		);
		assert.equal(
			copy.states.cancelled,
			"This booking was cancelled. Message {studio} if you think this is a mistake.",
		);
		assert.equal(
			copy.load.dead,
			"This link doesn't work any more. Ask the studio to send you a new one.",
		);
		assert.equal(
			copy.load["rate-limited"],
			"Too many tries. Wait a few minutes, then reload the page.",
		);
		assert.equal(
			copy.load.failed,
			"We couldn't load your deposit. Check your connection.",
		);
	});

	test("says the studio is paid directly, never Tattoo Drip", () => {
		assert.match(copy.footer, /\{studio\} directly/);
		assert.match(copy.footer, /never handles your money/);
	});
});

describe("the head strings", () => {
	test("live in head-copy.ts, which copy.ts carries whole", () => {
		for (const key of Object.keys(headCopy) as Array<keyof typeof headCopy>) {
			assert.equal(copy[key], headCopy[key], key);
		}
		assert.deepEqual(Object.keys(headCopy).sort(), [
			"description",
			"descriptionWithStudio",
			"title",
			"titleWithStudio",
		]);
	});
});
