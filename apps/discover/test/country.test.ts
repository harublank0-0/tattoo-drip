import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	COUNTRY_COOKIE_MAX_AGE,
	countryCookie,
	countryName,
	countryOptions,
	normalizeCountry,
	pageCountry,
	preferredCountry,
	readCookie,
	requestPreference,
	resolveCountry,
	safeReturnPath,
	switchCountryPath,
} from "../src/lib/country.ts";
import { countryPreferenceResponse } from "../src/lib/preference.ts";

const MARKETS = ["NP", "IN"];
const BASE = { markets: MARKETS, fallback: "NP" };

describe("country codes", () => {
	test("an assigned ISO 3166-1 alpha-2 code, trimmed and upper-cased; anything else is none", () => {
		assert.equal(normalizeCountry("np"), "NP");
		assert.equal(normalizeCountry(" In "), "IN");
		assert.equal(normalizeCountry("US"), "US");
		for (const bad of [
			"",
			"N",
			"NPL",
			"XX", // Cloudflare's "unknown"
			"T1", // Cloudflare's Tor
			"EU",
			"UK",
			"ZZ",
			"XK",
			"N1",
			"np\u0000",
			undefined,
			null,
			42,
			["NP"],
		]) {
			assert.equal(normalizeCountry(bad), undefined, String(bad));
		}
	});

	test("names come from Intl in English, whatever the runtime's locale", () => {
		assert.equal(countryName("NP"), "Nepal");
		assert.equal(countryName("in"), "India");
		assert.equal(countryName("XX"), "XX");
	});

	test("a selector offers the markets, and the current country when it isn't one", () => {
		assert.deepEqual(countryOptions(MARKETS, "IN"), ["NP", "IN"]);
		assert.deepEqual(countryOptions(["NP"], "NP"), ["NP"]);
		assert.deepEqual(countryOptions(["NP"], "US"), ["NP", "US"]);
	});
});

describe("resolving a page's country", () => {
	test("priority: the address, then the cookie, then trusted geolocation, then the default", () => {
		const all = { ...BASE, url: "in", cookie: "NP", trustedHeader: "NP" };
		assert.deepEqual(resolveCountry(all), { country: "IN", source: "url" });
		assert.deepEqual(resolveCountry({ ...all, url: undefined }), {
			country: "NP",
			source: "cookie",
		});
		assert.deepEqual(
			resolveCountry({ ...BASE, cookie: "in", trustedHeader: "NP" }),
			{ country: "IN", source: "cookie" },
		);
		assert.deepEqual(resolveCountry({ ...BASE, trustedHeader: "in" }), {
			country: "IN",
			source: "geo",
		});
		assert.deepEqual(resolveCountry(BASE), {
			country: "NP",
			source: "fallback",
		});
	});

	test("an explicit address may name any assigned country, even one that isn't a market", () => {
		assert.deepEqual(resolveCountry({ ...BASE, url: "us", cookie: "IN" }), {
			country: "US",
			source: "url",
		});
		// Malformed or unassigned: ignored, the preference stands.
		for (const url of ["XX1", "XX", "", "Nepal", 7]) {
			assert.deepEqual(
				resolveCountry({ ...BASE, url, cookie: "IN" }),
				{ country: "IN", source: "cookie" },
				String(url),
			);
		}
	});

	test("a cookie or a header that isn't a market (or isn't a code) is ignored", () => {
		assert.deepEqual(
			preferredCountry({ ...BASE, cookie: "US", trustedHeader: "IN" }),
			{ country: "IN", source: "geo" },
		);
		assert.deepEqual(
			preferredCountry({ ...BASE, cookie: "garbage", trustedHeader: "XX" }),
			{ country: "NP", source: "fallback" },
		);
		// An expired cookie is simply absent.
		assert.deepEqual(preferredCountry({ ...BASE, cookie: undefined }), {
			country: "NP",
			source: "fallback",
		});
	});

	test("the page's country: its address's, else the preference", () => {
		const preference = { country: "IN", source: "cookie" } as const;
		assert.deepEqual(pageCountry(undefined, preference), preference);
		assert.deepEqual(pageCountry("np", preference), {
			country: "NP",
			source: "url",
		});
		assert.deepEqual(pageCountry("XX1", preference), preference);
	});

	test("a request's preference reads the trusted header only when one is configured", () => {
		const headers = new Headers({
			"CF-IPCountry": "IN",
			"X-Discover-Country": "IN",
			Cookie: "other=1; td_country=np; x=y",
		});
		const off = { markets: MARKETS, defaultCountry: "NP", geoHeader: null };
		const on = { ...off, geoHeader: "x-discover-country" };
		// The cookie wins either way.
		assert.deepEqual(requestPreference(headers, on), {
			country: "NP",
			source: "cookie",
		});
		headers.delete("Cookie");
		assert.deepEqual(requestPreference(headers, on), {
			country: "IN",
			source: "geo",
		});
		// Geolocation off: neither the raw CF-IPCountry nor the internal header is read.
		assert.deepEqual(requestPreference(headers, off), {
			country: "NP",
			source: "fallback",
		});
		// On, but the trusted proxy sent nothing (nginx blanks it for anyone but cloudflared).
		headers.delete("X-Discover-Country");
		assert.deepEqual(requestPreference(headers, on), {
			country: "NP",
			source: "fallback",
		});
	});
});

describe("the preference cookie", () => {
	test("host-only, whole site, Lax, HttpOnly, about a year; Secure on https", () => {
		assert.equal(
			countryCookie("IN", { secure: true }),
			`td_country=IN; Path=/; Max-Age=${COUNTRY_COOKIE_MAX_AGE}; SameSite=Lax; HttpOnly; Secure`,
		);
		const local = countryCookie("NP", { secure: false });
		assert.doesNotMatch(local, /Secure|Domain/i);
		assert.ok(COUNTRY_COOKIE_MAX_AGE >= 360 * 24 * 3600);
	});

	test("reading a Cookie header", () => {
		assert.equal(readCookie("a=1; td_country=IN", "td_country"), "IN");
		assert.equal(readCookie("xtd_country=IN", "td_country"), undefined);
		assert.equal(readCookie("", "td_country"), undefined);
		assert.equal(readCookie(null, "td_country"), undefined);
	});
});

describe("switching country", () => {
	test("a return path stays on this site: anything else is /", () => {
		assert.equal(
			safeReturnPath("/explore/studios?q=ink#x"),
			"/explore/studios?q=ink#x",
		);
		for (const bad of [
			"https://evil.example/",
			"//evil.example/",
			"/\\evil.example",
			"\\\\evil.example",
			"javascript:alert(1)",
			"/\t/evil.example",
			"/\n/evil.example",
			"explore",
			"",
			`/${"a".repeat(2001)}`,
			undefined,
			42,
		]) {
			assert.equal(safeReturnPath(bad), "/", String(bad));
		}
	});

	test("a page naming a country gets the new one, drops its city and keeps the rest", () => {
		assert.equal(
			switchCountryPath(
				"/explore/studios?q=ink&country=NP&city=pokhara&style=blackwork",
				"IN",
			),
			"/explore/studios?q=ink&country=IN&style=blackwork",
		);
		// No country in the address: it follows the preference, unchanged.
		assert.equal(switchCountryPath("/pricing", "IN"), "/pricing");
		assert.equal(
			switchCountryPath("/explore/studios?q=ink", "IN"),
			"/explore/studios?q=ink",
		);
		assert.equal(switchCountryPath("//evil.example", "IN"), "/");
	});
});

describe("POST /preferences/country", () => {
	const config = { markets: MARKETS, siteUrl: "https://tattoodrip.app" };
	const post = (
		fields: Record<string, string>,
		headers: Record<string, string> = {},
	) =>
		countryPreferenceResponse(
			new Request("http://discover.test/preferences/country", {
				method: "POST",
				headers,
				body: new URLSearchParams(fields),
			}),
			config,
		);

	test("a form post saves a market and redirects back, with the address's country replaced", async () => {
		const response = await post({
			country: "in",
			return: "/explore/studios?country=NP&city=pokhara&q=ink",
		});
		assert.equal(response.status, 303);
		assert.equal(
			response.headers.get("location"),
			"/explore/studios?country=IN&q=ink",
		);
		assert.equal(
			response.headers.get("set-cookie"),
			`td_country=IN; Path=/; Max-Age=${COUNTRY_COOKIE_MAX_AGE}; SameSite=Lax; HttpOnly; Secure`,
		);
		assert.equal(response.headers.get("cache-control"), "no-store");
	});

	test("never an open redirect", async () => {
		for (const back of ["https://evil.example/", "//evil.example", "/\\x"]) {
			const response = await post({ country: "NP", return: back });
			assert.equal(response.headers.get("location"), "/", back);
		}
	});

	test("a country that isn't a market is never saved", async () => {
		const form = await post({ country: "US", return: "/pricing" });
		assert.equal(form.status, 303);
		assert.equal(form.headers.get("location"), "/pricing");
		assert.equal(form.headers.get("set-cookie"), null);
		const json = await post({ country: "XX" }, { Accept: "application/json" });
		assert.equal(json.status, 422);
		assert.equal(json.headers.get("set-cookie"), null);
	});

	test("the selector's fetch gets JSON; a cross-site post is refused", async () => {
		const json = await post(
			{ country: "NP", return: "/" },
			{ Accept: "application/json", "Sec-Fetch-Site": "same-origin" },
		);
		assert.equal(json.status, 200);
		assert.deepEqual(await json.json(), { country: "NP" });
		assert.match(json.headers.get("set-cookie") ?? "", /^td_country=NP;/);
		for (const site of ["cross-site", "same-site"]) {
			const refused = await post({ country: "NP" }, { "Sec-Fetch-Site": site });
			assert.equal(refused.status, 403, site);
			assert.equal(refused.headers.get("set-cookie"), null);
		}
	});

	test("no Secure flag on a local http site", async () => {
		const response = await countryPreferenceResponse(
			new Request("http://localhost:3100/preferences/country", {
				method: "POST",
				body: new URLSearchParams({ country: "NP" }),
			}),
			{ markets: MARKETS, siteUrl: "http://localhost:3100" },
		);
		assert.doesNotMatch(response.headers.get("set-cookie") ?? "", /Secure/);
	});
});
