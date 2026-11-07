import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	bookingLinks,
	generalRequest,
	isReferralShaped,
	safeSiteUrl,
	safeSocialUrl,
} from "../src/lib/booking.ts";

const REF = "eyJ2IjoxfQ.c2lnbmF0dXJl";

const studio = (
	bookingUrl: string,
	storefrontUrl = "https://ink.tattoodrip.page",
) => ({
	bookingUrl,
	storefrontUrl,
});

describe("the booking hand-off (D08)", () => {
	test("a studio's request: the API's /book on the studio's host, with its referral", () => {
		assert.deepEqual(
			bookingLinks(studio(`https://ink.tattoodrip.page/book?ref=${REF}`)),
			{
				request: `https://ink.tattoodrip.page/book?ref=${REF}`,
				site: "https://ink.tattoodrip.page/",
			},
		);
	});

	test("an artist's request names exactly that artist; a studio's names none", () => {
		const url = `https://ink.tattoodrip.page/book?artist=maya&ref=${REF}`;
		assert.equal(
			bookingLinks(studio(url), "maya").request,
			`https://ink.tattoodrip.page/book?artist=maya&ref=${REF}`,
		);
		// Another artist's link, or a studio profile: the general form.
		assert.equal(
			bookingLinks(studio(url), "sita").request,
			`https://ink.tattoodrip.page/book?ref=${REF}`,
		);
		assert.equal(
			bookingLinks(studio(url)).request,
			`https://ink.tattoodrip.page/book?ref=${REF}`,
		);
		assert.equal(
			generalRequest(`https://ink.tattoodrip.page/book?artist=maya&ref=${REF}`),
			`https://ink.tattoodrip.page/book?ref=${REF}`,
		);
	});

	test("only the storefront's own parameters survive; a malformed referral is dropped, the request kept", () => {
		assert.equal(
			bookingLinks(
				studio(
					"https://ink.tattoodrip.page/book?ref=not-a-token&next=https://evil.test&utm_source=x",
				),
			).request,
			"https://ink.tattoodrip.page/book",
		);
		assert.equal(isReferralShaped(REF), true);
		assert.equal(
			isReferralShaped(`${"a".repeat(500)}.${"b".repeat(20)}`),
			false,
		);
		assert.equal(isReferralShaped("a.b.c"), false);
		assert.equal(isReferralShaped(undefined), false);
	});

	test("http only on localhost; credentials, other schemes, other hosts and other paths are no link", () => {
		// A developer's studio pages.
		assert.equal(
			bookingLinks(
				studio(
					`http://ink.localhost:3000/book?ref=${REF}`,
					"http://ink.localhost:3000/",
				),
			).request,
			`http://ink.localhost:3000/book?ref=${REF}`,
		);
		for (const [booking, site] of [
			// http off localhost
			[
				`http://ink.tattoodrip.page/book?ref=${REF}`,
				"http://ink.tattoodrip.page/",
			],
			// another host than the studio page's
			[`https://evil.test/book?ref=${REF}`, "https://ink.tattoodrip.page/"],
			[`https://other.tattoodrip.page/book`, "https://ink.tattoodrip.page/"],
			// the same host on another port or scheme
			["https://ink.localhost:4000/book", "https://ink.localhost:3000/"],
			["http://ink.localhost:3000/book", "https://ink.localhost:3000/"],
			// not the booking page
			[
				"https://ink.tattoodrip.page/book/../admin",
				"https://ink.tattoodrip.page/",
			],
			["https://ink.tattoodrip.page/", "https://ink.tattoodrip.page/"],
			// credentials, other schemes, garbage
			[
				"https://user:pw@ink.tattoodrip.page/book",
				"https://ink.tattoodrip.page/",
			],
			[
				"javascript:alert(1)//ink.tattoodrip.page/book",
				"https://ink.tattoodrip.page/",
			],
			["/book", "https://ink.tattoodrip.page/"],
			["", ""],
		] as const)
			assert.equal(bookingLinks(studio(booking, site)).request, null, booking);
		// An unsafe site is no "Visit studio site" either.
		assert.equal(safeSiteUrl("http://ink.tattoodrip.page/"), null);
		assert.equal(safeSiteUrl("ftp://ink.localhost/"), null);
		assert.equal(
			safeSiteUrl("https://ink.localhost.evil.test/")?.host,
			"ink.localhost.evil.test",
		);
		assert.equal(safeSiteUrl("http://ink.localhost.evil.test/"), null);
		assert.equal(
			bookingLinks(
				studio("https://ink.tattoodrip.page/book", "javascript:alert(1)"),
			).site,
			null,
		);
	});

	test("social links are https only", () => {
		assert.equal(
			safeSocialUrl("https://instagram.com/ink"),
			"https://instagram.com/ink",
		);
		assert.equal(safeSocialUrl("http://instagram.com/ink"), null);
		assert.equal(safeSocialUrl("javascript:alert(1)"), null);
	});
});
