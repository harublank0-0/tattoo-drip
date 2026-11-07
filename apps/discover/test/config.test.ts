import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseDiscoverConfig, readOrigin } from "../src/lib/config.ts";

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
		});
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
