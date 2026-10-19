import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	dehydrateSite,
	hydrateSite,
	parseSiteOrigin,
	SiteRef,
} from "../../src/site/context.ts";

const ORIGIN = "https://black-needle-48.tattoodrip.com";
const INVALID = /site address is missing or invalid/;

describe("SiteRef", () => {
	test("has no origin until it is set", () => {
		assert.throws(() => new SiteRef().origin, /not set yet/);
	});

	test("is set once", () => {
		const site = new SiteRef();
		site.connect(ORIGIN);

		assert.equal(site.origin, ORIGIN);
		assert.throws(() => site.connect(ORIGIN), /already set/);
	});

	test("is never set to something that isn't an origin", () => {
		assert.throws(
			() => new SiteRef().connect("https://x.example/path"),
			INVALID,
		);
	});
});

describe("parseSiteOrigin", () => {
	test("accepts an http(s) origin", () => {
		for (const origin of [ORIGIN, "http://black-needle-48.localhost:3000"]) {
			assert.equal(parseSiteOrigin(origin), origin);
		}
	});

	test("refuses anything else", () => {
		for (const value of [
			undefined,
			null,
			42,
			"",
			"black-needle-48.tattoodrip.com",
			`${ORIGIN}/`,
			`${ORIGIN}/artists`,
			"https://Black-Needle.tattoodrip.com",
			"javascript:alert(1)",
			"ftp://black-needle-48.tattoodrip.com",
			"https://user@black-needle-48.tattoodrip.com",
		]) {
			assert.throws(
				() => parseSiteOrigin(value),
				INVALID,
				JSON.stringify(value),
			);
		}
	});
});

describe("what the browser gets", () => {
	test("only the origin, and it arrives through JSON as it left", () => {
		const server = new SiteRef();
		server.connect(ORIGIN);
		const dehydrated = dehydrateSite(server);
		assert.deepEqual(dehydrated, { site: { origin: ORIGIN } });

		const browser = new SiteRef();
		hydrateSite(browser, JSON.parse(JSON.stringify(dehydrated)));
		assert.equal(browser.origin, ORIGIN);
	});

	test("a page without a valid origin can't hydrate", () => {
		for (const dehydrated of [
			undefined,
			{},
			{ site: null },
			{ site: { origin: "x" } },
		]) {
			assert.throws(() => hydrateSite(new SiteRef(), dehydrated), INVALID);
		}
	});
});
