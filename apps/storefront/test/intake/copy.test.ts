import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	copy,
	fill,
	fillParts,
	NOTICE_CODES,
	PHOTO_PROBLEMS,
} from "../../src/intake/copy.ts";

/** The placeholders the form fills somewhere. */
const PLACEHOLDERS = new Set([
	"studio",
	"phone",
	"max",
	"count",
	"size",
	"index",
	"name",
	"message",
	"artist",
	"wait",
	"photos",
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

describe("fill", () => {
	test("puts each value in its placeholder", () => {
		assert.equal(
			fill("{studio} will reply at {phone}.", {
				studio: "Black Needle",
				phone: "9812345678",
			}),
			"Black Needle will reply at 9812345678.",
		);
		assert.equal(fill("{count} of {max}", { count: 2, max: 5 }), "2 of 5");
	});

	test("leaves a placeholder it has no value for", () => {
		assert.equal(fill("Hi {studio}", {}), "Hi {studio}");
	});

	test("inserts values as they are, never as more placeholders", () => {
		assert.equal(
			fill("{name} isn't a photo", { name: "{studio}.png" }),
			"{studio}.png isn't a photo",
		);
	});
});

describe("fillParts", () => {
	test("splits a template into text and values", () => {
		assert.deepEqual(
			fillParts("Tell {studio} about it, {name}.", {
				studio: "अर्जुन",
				name: "Sita",
			}),
			[
				{ text: "Tell " },
				{ value: "अर्जुन" },
				{ text: " about it, " },
				{ value: "Sita" },
				{ text: "." },
			],
		);
	});

	test("keeps text without placeholders whole, and an unknown placeholder as text", () => {
		assert.deepEqual(fillParts("Send inquiry", {}), [{ text: "Send inquiry" }]);
		assert.deepEqual(fillParts("Hi {who}", {}), [{ text: "Hi {who}" }]);
	});
});

describe("the copy", () => {
	test("uses only the placeholders the form fills, and no stray braces", () => {
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

	test("explains every notice and every photo problem", () => {
		for (const code of NOTICE_CODES) {
			assert.ok(copy.notices[code].title.length > 0, code);
			assert.ok(copy.notices[code].body.length > 0, code);
		}
		for (const problem of PHOTO_PROBLEMS) {
			assert.match(copy.photos.problems[problem], /\{name\}/, problem);
		}
		// Too big by bytes or by pixels: the text names neither limit.
		assert.doesNotMatch(copy.photos.problems["too-big"], /50 MB|megapixel/i);
	});

	test("says a send stopped because a photo couldn't be prepared", () => {
		assert.match(copy.photos.stopped, /couldn't be prepared/);
		assert.match(copy.photos.stopped, /wasn't sent/);
		assert.match(copy.photos.stopped, /send again/);
	});

	test("labels every source channel, in the contract's order", () => {
		assert.deepEqual(Object.keys(copy.channels), [
			"instagram",
			"facebook",
			"tiktok",
			"google",
			"friend",
			"other",
		]);
	});

	test("tells the person the studio replies on WhatsApp or Viber, at their number", () => {
		assert.match(copy.sent.body, /WhatsApp or Viber/);
		assert.match(copy.sent.body, /\{phone\}/);
		assert.match(copy.sent.body, /\{studio\}/);
	});

	test("promises one thing at the top: only the studio sees the answers", () => {
		assert.equal(copy.reassurance, "Only {studio} sees what you send.");
	});

	test("names Cloudflare, and who runs the page, in the small print under Send", () => {
		assert.match(copy.privacy, /Cloudflare/);
		assert.match(copy.privacy, /\{studio\}/);
		assert.match(copy.privacy, /Tattoo Drip runs this page for \{studio\}/);
		assert.doesNotMatch(copy.privacy, /Only \{studio\} sees/);
	});
});
