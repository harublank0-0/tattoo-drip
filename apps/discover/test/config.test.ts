import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseDiscoverConfig, publicSettings } from "../src/lib/config.ts";
import { readOrigin } from "../src/lib/origin.ts";

const VALID = {
	API_URL: "https://api.tattoodrip.app",
	DISCOVER_URL: "https://tattoodrip.app",
	APP_URL: "https://app.tattoodrip.app",
};

describe("Discover settings", () => {
	test("valid settings parse, indexing is off by default and photos come from the API", () => {
		assert.deepEqual(parseDiscoverConfig(VALID), {
			apiUrl: "https://api.tattoodrip.app",
			mediaUrl: "https://api.tattoodrip.app",
			siteUrl: "https://tattoodrip.app",
			studioOsUrl: "https://app.tattoodrip.app",
			indexing: false,
			markets: ["NP"],
			defaultCountry: "NP",
			geoHeader: null,
			sitemapCacheSeconds: 600,
			serverKey: null,
		});
	});

	test("the server key (D11): required in production, a token68 of 32 to 256 characters, never public", () => {
		const KEY = "a".repeat(32);
		assert.equal(
			parseDiscoverConfig({ ...VALID, DISCOVER_SERVER_KEY: ` ${KEY} ` })
				.serverKey,
			KEY,
		);
		assert.throws(
			() => parseDiscoverConfig({ ...VALID, NODE_ENV: "production" }),
			/DISCOVER_SERVER_KEY is missing/,
		);
		assert.equal(
			parseDiscoverConfig({
				...VALID,
				NODE_ENV: "production",
				DISCOVER_SERVER_KEY: `${KEY}==`,
			}).serverKey,
			`${KEY}==`,
		);
		for (const bad of ["short", "a".repeat(257), `${KEY} x`, `${KEY}===`]) {
			assert.throws(
				() => parseDiscoverConfig({ ...VALID, DISCOVER_SERVER_KEY: bad }),
				(error: Error) =>
					/DISCOVER_SERVER_KEY is not valid/.test(error.message) &&
					!error.message.includes(bad),
				bad.slice(0, 20),
			);
		}
		const config = parseDiscoverConfig({ ...VALID, DISCOVER_SERVER_KEY: KEY });
		assert.equal("serverKey" in publicSettings(config), false);
		assert.doesNotMatch(JSON.stringify(publicSettings(config)), /aaaa/);
	});

	test("the sitemap cache: whole seconds from 0 (off) to 3600, server only", () => {
		for (const [value, seconds] of [
			["0", 0],
			[" 120 ", 120],
			["3600", 3600],
		] as const) {
			assert.equal(
				parseDiscoverConfig({ ...VALID, DISCOVER_SITEMAP_CACHE_SECONDS: value })
					.sitemapCacheSeconds,
				seconds,
			);
		}
		for (const bad of ["-1", "3601", "1.5", "ten", "1e3"]) {
			assert.throws(
				() =>
					parseDiscoverConfig({
						...VALID,
						DISCOVER_SITEMAP_CACHE_SECONDS: bad,
					}),
				/DISCOVER_SITEMAP_CACHE_SECONDS is not valid/,
				bad,
			);
		}
		assert.equal(
			"sitemapCacheSeconds" in publicSettings(parseDiscoverConfig(VALID)),
			false,
		);
	});

	test("markets: a comma list of assigned ISO codes, normalised and de-duplicated; the default is one of them", () => {
		const config = parseDiscoverConfig({
			...VALID,
			DISCOVER_MARKETS: " np, IN ,np ",
			DISCOVER_DEFAULT_COUNTRY: "in",
		});
		assert.deepEqual(config.markets, ["NP", "IN"]);
		assert.equal(config.defaultCountry, "IN");
		// Unset default: the first market.
		assert.equal(
			parseDiscoverConfig({ ...VALID, DISCOVER_MARKETS: "IN,NP" })
				.defaultCountry,
			"IN",
		);
		for (const markets of ["NP,XX", "NPL", "NP,,IN", ",", "EU", "UK"]) {
			assert.throws(
				() => parseDiscoverConfig({ ...VALID, DISCOVER_MARKETS: markets }),
				(error: Error) => {
					assert.match(error.message, /DISCOVER_MARKETS is not valid/);
					if (/XX|NPL/.test(markets))
						assert.doesNotMatch(error.message, /XX|NPL/);
					return true;
				},
				markets,
			);
		}
		assert.throws(
			() => parseDiscoverConfig({ ...VALID, DISCOVER_DEFAULT_COUNTRY: "IN" }),
			/DISCOVER_DEFAULT_COUNTRY is not valid/,
		);
		assert.throws(
			() =>
				parseDiscoverConfig({ ...VALID, DISCOVER_DEFAULT_COUNTRY: "Nepal" }),
			/DISCOVER_DEFAULT_COUNTRY is not valid/,
		);
	});

	test("geolocation is off unless a trusted header is named, and never CF-IPCountry; the browser never gets its name", () => {
		assert.equal(parseDiscoverConfig(VALID).geoHeader, null);
		assert.equal(
			parseDiscoverConfig({ ...VALID, DISCOVER_GEO_HEADER: " " }).geoHeader,
			null,
		);
		const config = parseDiscoverConfig({
			...VALID,
			DISCOVER_GEO_HEADER: "X-Discover-Country",
		});
		assert.equal(config.geoHeader, "x-discover-country");
		assert.equal("geoHeader" in publicSettings(config), false);
		for (const bad of ["CF-IPCountry", "cf-ipcountry", "X Country", "X:Y"]) {
			assert.throws(
				() => parseDiscoverConfig({ ...VALID, DISCOVER_GEO_HEADER: bad }),
				/DISCOVER_GEO_HEADER is not valid/,
				bad,
			);
		}
	});

	test("indexing is on only when it says so", () => {
		assert.equal(
			parseDiscoverConfig({ ...VALID, DISCOVER_INDEXING: "on" }).indexing,
			true,
		);
		assert.equal(
			parseDiscoverConfig({ ...VALID, DISCOVER_INDEXING: "ON" }).indexing,
			true,
		);
		assert.equal(
			parseDiscoverConfig({ ...VALID, DISCOVER_INDEXING: "off" }).indexing,
			false,
		);
		assert.throws(
			() => parseDiscoverConfig({ ...VALID, DISCOVER_INDEXING: "yes" }),
			/DISCOVER_INDEXING is not valid/,
		);
	});

	test("every missing setting is named, and no value is ever printed", () => {
		assert.throws(
			() =>
				parseDiscoverConfig({ API_URL: "https://user:secret@api.example.com" }),
			(error: Error) => {
				assert.match(error.message, /API_URL is not valid/);
				assert.match(error.message, /DISCOVER_URL is missing/);
				assert.match(error.message, /APP_URL is missing/);
				assert.doesNotMatch(error.message, /secret/);
				return true;
			},
		);
	});

	test("Discover never shares Studio OS's host", () => {
		assert.throws(
			() =>
				parseDiscoverConfig({ ...VALID, APP_URL: "https://tattoodrip.app" }),
			/must be different hosts/,
		);
	});

	test("an origin is https, or http on localhost, with no path, query or credentials", () => {
		assert.equal(
			readOrigin("https://api.example.com/"),
			"https://api.example.com",
		);
		assert.equal(readOrigin("http://localhost:3333"), "http://localhost:3333");
		assert.equal(
			readOrigin("http://app.localhost:3333"),
			"http://app.localhost:3333",
		);
		for (const bad of [
			"http://api.example.com",
			"https://api.example.com/api",
			"https://api.example.com?x=1",
			"https://u:p@api.example.com",
			"ftp://api.example.com",
			"api.example.com",
		]) {
			assert.equal(readOrigin(bad), null, bad);
		}
	});
});
