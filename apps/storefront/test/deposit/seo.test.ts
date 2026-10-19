import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { DEPOSIT_PAGE_HEADERS, depositHead } from "../../src/deposit/seo.ts";

describe("the deposit page's head", () => {
	test("never indexed, no Referer, and the studio named for a chat app's preview", () => {
		const head = depositHead("Black Needle");
		const description =
			"Pay your deposit to Black Needle, then send a screenshot of the payment.";
		assert.deepEqual(head.meta, [
			{ title: "Pay your deposit · Black Needle" },
			{ name: "description", content: description },
			{ name: "robots", content: "noindex, nofollow" },
			{ name: "referrer", content: "no-referrer" },
			{ property: "og:type", content: "website" },
			{ property: "og:site_name", content: "Black Needle" },
			{ property: "og:title", content: "Pay your deposit · Black Needle" },
			{ property: "og:description", content: description },
			{ name: "twitter:card", content: "summary" },
		]);
		assert.deepEqual(head.links, []);
		assert.deepEqual(head.scripts, []);
	});

	test("without the studio (a failed read) it still says what the page is", () => {
		const head = depositHead(null);
		assert.deepEqual(head.meta.slice(0, 4), [
			{ title: "Pay your deposit" },
			{
				name: "description",
				content: "Pay your deposit, then send a screenshot of the payment.",
			},
			{ name: "robots", content: "noindex, nofollow" },
			{ name: "referrer", content: "no-referrer" },
		]);
		assert.ok(
			!head.meta.some(
				(meta) => "property" in meta && meta.property === "og:site_name",
			),
		);
	});

	test("the response's headers: never stored, no Referer, never indexed", () => {
		assert.deepEqual(DEPOSIT_PAGE_HEADERS, {
			"Cache-Control": "no-store",
			"Referrer-Policy": "no-referrer",
			"X-Robots-Tag": "noindex, nofollow",
		});
	});
});
