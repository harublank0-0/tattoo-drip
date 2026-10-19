import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	dehydrateSite,
	hydrateSite,
	parseChallengeSiteKey,
	parseSiteOrigin,
	SiteRef,
} from "../../src/site/context.ts";

const ORIGIN = "https://black-needle-48.tattoodrip.com";
const INVALID = /site address is missing or invalid/;
const SITE_KEY = "1x00000000000000000000AA";

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
	test("the origin and the public site key, through JSON as they left", () => {
		const server = new SiteRef();
		server.connect(ORIGIN, SITE_KEY);
		const dehydrated = dehydrateSite(server);
		assert.deepEqual(dehydrated, {
			site: { origin: ORIGIN, challengeSiteKey: SITE_KEY },
		});

		const browser = new SiteRef();
		hydrateSite(browser, JSON.parse(JSON.stringify(dehydrated)));
		assert.equal(browser.origin, ORIGIN);
		assert.equal(browser.challengeSiteKey, SITE_KEY);
	});

	test("no site key (development) travels as null", () => {
		const server = new SiteRef();
		server.connect(ORIGIN);
		assert.deepEqual(dehydrateSite(server), {
			site: { origin: ORIGIN, challengeSiteKey: null },
		});

		const browser = new SiteRef();
		hydrateSite(browser, { site: { origin: ORIGIN } });
		assert.equal(browser.challengeSiteKey, null, "a page from an older server");
	});

	test("a malformed site key can't hydrate", () => {
		for (const challengeSiteKey of [
			"short",
			"<script>",
			42,
			"a b c d e f g h",
		]) {
			assert.throws(
				() =>
					hydrateSite(new SiteRef(), {
						site: { origin: ORIGIN, challengeSiteKey },
					}),
				INVALID,
				String(challengeSiteKey),
			);
		}
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

describe("parseChallengeSiteKey", () => {
	test("takes a Turnstile site key, or nothing", () => {
		assert.equal(parseChallengeSiteKey(SITE_KEY), SITE_KEY);
		assert.equal(
			parseChallengeSiteKey("0x4AAAAAAAB_c-Dd1234"),
			"0x4AAAAAAAB_c-Dd1234",
		);
		assert.equal(parseChallengeSiteKey(null), null);
		assert.equal(parseChallengeSiteKey(undefined), null);
	});

	test("refuses anything that could break out of where it goes", () => {
		for (const value of [
			"",
			"a".repeat(9),
			"a".repeat(101),
			'key"onload',
			"key key key",
			7,
		]) {
			assert.throws(() => parseChallengeSiteKey(value), INVALID, String(value));
		}
	});

	test("a SiteRef has no site key until it is set", () => {
		assert.throws(() => new SiteRef().challengeSiteKey, /not set yet/);
	});
});
