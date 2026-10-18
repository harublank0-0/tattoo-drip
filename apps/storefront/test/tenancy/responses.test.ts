import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { StorefrontConfig } from "../../src/tenancy/config.ts";
import {
	aliasLocation,
	landingResponse,
	notFoundResponse,
	redirectResponse,
	unavailableResponse,
} from "../../src/tenancy/responses.ts";

const PROD: StorefrontConfig = {
	apiUrl: "https://api.tattoodrip.app",
	protocol: "https:",
	baseHost: "tattoodrip.com",
	port: "",
};
const DEV: StorefrontConfig = {
	apiUrl: "http://localhost:3333",
	protocol: "http:",
	baseHost: "localhost",
	port: ":3000",
};
const SHORT = "public, max-age=0, s-maxage=60";

/** Checks what every page shares and returns its body. */
async function pageBody(
	response: Response,
	status: number,
	cacheControl: string,
): Promise<string> {
	assert.equal(response.status, status);
	assert.equal(
		response.headers.get("content-type"),
		"text/html; charset=utf-8",
	);
	assert.equal(response.headers.get("cache-control"), cacheControl);
	assert.equal(response.headers.get("x-content-type-options"), "nosniff");
	assert.equal(
		response.headers.get("content-security-policy"),
		"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
	);
	const body = await response.text();
	assert.match(body, /^<!doctype html>/);
	assert.match(body, /<meta name="robots" content="noindex">/);
	assert.doesNotMatch(body, /<script|<link|src=/i);
	return body;
}

describe("pages", () => {
	test("the landing page is a 200 kept a minute at the CDN", async () => {
		const body = await pageBody(landingResponse(), 200, SHORT);
		assert.match(body, /<title>Tattoo Drip<\/title>/);
		assert.match(body, /<h1>Tattoo Drip<\/h1>/);
	});

	test("the not-found page is a 404 kept a minute at the CDN", async () => {
		const body = await pageBody(notFoundResponse(), 404, SHORT);
		assert.match(body, /<title>Studio not found<\/title>/);
		assert.match(body, /<h1>We couldn't find this studio<\/h1>/);
	});

	test("the unavailable page is a 503, never stored, that says when to retry", async () => {
		const response = unavailableResponse();
		const body = await pageBody(response, 503, "no-store");
		assert.equal(response.headers.get("retry-after"), "30");
		assert.match(body, /<h1>This page can't load right now<\/h1>/);
	});
});

describe("redirectResponse", () => {
	test("is a 302 that is never stored, with no body", async () => {
		const response = redirectResponse("https://inkhouse.tattoodrip.com/flash");
		assert.equal(response.status, 302);
		assert.equal(
			response.headers.get("location"),
			"https://inkhouse.tattoodrip.com/flash",
		);
		assert.equal(response.headers.get("cache-control"), "no-store");
		assert.equal(await response.text(), "");
	});
});

describe("aliasLocation", () => {
	test("keeps the path and query on the current slug's origin", () => {
		assert.equal(
			aliasLocation(
				DEV,
				"inkhouse",
				"http://old-ink.localhost:3000/flash?style=fine-line",
			),
			"http://inkhouse.localhost:3000/flash?style=fine-line",
		);
		assert.equal(
			aliasLocation(PROD, "inkhouse", "https://old-ink.tattoodrip.com/"),
			"https://inkhouse.tattoodrip.com/",
		);
	});

	test("takes the origin from the settings, never from the request", () => {
		assert.equal(
			aliasLocation(PROD, "inkhouse", "http://evil.test:8080/about?x=1"),
			"https://inkhouse.tattoodrip.com/about?x=1",
		);
	});

	test("a path that looks like another host stays a path on the studio's origin", () => {
		for (const url of [
			"http://old-ink.tattoodrip.com//evil.test/x",
			"http://old-ink.tattoodrip.com/\\evil.test",
			"http://old-ink.tattoodrip.com/%2F%2Fevil.test",
		]) {
			const location = aliasLocation(PROD, "inkhouse", url);
			assert.equal(
				new URL(location).origin,
				"https://inkhouse.tattoodrip.com",
				url,
			);
		}
	});

	test("refuses anything but a stored slug", () => {
		for (const slug of ["evil.test/", "Inkhouse", "ink.house", "", "ab"]) {
			assert.throws(
				() => aliasLocation(PROD, slug, "https://old-ink.tattoodrip.com/"),
				/stored tenant slug/,
				slug,
			);
		}
	});
});
