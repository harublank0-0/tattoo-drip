import { test } from "@japa/runner";
import { checkAppOrigin, studioDomain } from "#services/app_origin";

const HTTPS = /APP_URL must be an https URL in production/;
const SEPARATE = /must be on separate domains in production/;

test.group("APP_URL at boot (TAT-9)", () => {
	test("outside production nothing is checked", ({ assert }) => {
		assert.doesNotThrow(() =>
			checkAppOrigin(
				"http://localhost:3333",
				"http://{tenant}.localhost:3000",
				false,
			),
		);
		assert.doesNotThrow(() =>
			checkAppOrigin(
				"http://app.example.com",
				"https://{tenant}.example.com",
				false,
			),
		);
	});

	test("in production APP_URL must be https", ({ assert }) => {
		for (const appUrl of [
			"http://app.tattoodrip.app",
			"http://localhost:3333",
			"app.tattoodrip.app",
		]) {
			assert.throws(
				() =>
					checkAppOrigin(appUrl, "https://{tenant}.tattoodrip.studio", true),
				HTTPS,
				appUrl,
			);
		}
	});

	test("separate domains pass", ({ assert }) => {
		for (const [appUrl, template] of [
			["https://app.tattoodrip.app", "https://{tenant}.tattoodrip.studio"],
			// Two names under a public suffix are separate.
			["https://app.tattoodrip.com.np", "https://{tenant}.inkpages.com.np"],
			["https://tattoodrip.app", "https://{tenant}-ink.tattoodrip.studio"],
			["https://203.0.113.5", "https://{tenant}.example.com"],
			["https://app.example.com:8443/", "https://{tenant}.example-studios.com"],
		]) {
			assert.doesNotThrow(
				() => checkAppOrigin(appUrl, template, true),
				`${appUrl} ${template}`,
			);
		}
	});

	test("an APP_URL on, under or above the studio pages' domain is refused", ({
		assert,
	}) => {
		for (const [appUrl, template] of [
			["https://app.example.com", "https://{tenant}.example.com"],
			["https://example.com", "https://{tenant}.example.com"],
			["https://app.example.com", "https://{tenant}.studios.app.example.com"],
			["https://app.example.com:8443", "https://{tenant}.example.com:3000"],
			["https://APP.Example.COM.", "https://{tenant}.example.com"],
			["https://app.example.com", "https://{tenant}-ink.example.com"],
		]) {
			assert.throws(
				() => checkAppOrigin(appUrl, template, true),
				SEPARATE,
				`${appUrl} ${template}`,
			);
		}
	});

	test("the message names both hosts and a layout that works", ({ assert }) => {
		assert.throws(
			() =>
				checkAppOrigin(
					"https://app.example.com",
					"https://{tenant}.example.com",
					true,
				),
			/APP_URL \(app\.example\.com\) and the studio pages \(STOREFRONT_URL, \*\.example\.com\).*https:\/\/app\.example\.com with studio pages on https:\/\/\{tenant\}\.example-studios\.com/,
		);
	});

	test("a loopback APP_URL (the local production trial) skips the domain comparison, never https", ({
		assert,
	}) => {
		for (const appUrl of ["https://localhost:8443", "https://127.0.0.1:8443"]) {
			assert.doesNotThrow(() =>
				checkAppOrigin(appUrl, "http://{tenant}.localhost:3000", true),
			);
		}
		assert.throws(
			() =>
				checkAppOrigin(
					"http://localhost:8443",
					"http://{tenant}.localhost:3000",
					true,
				),
			HTTPS,
		);
	});

	test("a missing STOREFRONT_URL is left to its own check", ({ assert }) => {
		assert.doesNotThrow(() =>
			checkAppOrigin("https://app.example.com", undefined, true),
		);
	});

	test("known limit: a sibling under a parent you own is not detected (the checklist covers it)", ({
		assert,
	}) => {
		// app.example.com and *.sites.example.com share example.com, but
		// without the Public Suffix List this looks like two .com.np names.
		assert.doesNotThrow(() =>
			checkAppOrigin(
				"https://app.example.com",
				"https://{tenant}.sites.example.com",
				true,
			),
		);
	});

	test("studioDomain is the labels every studio host shares", ({ assert }) => {
		assert.equal(studioDomain("https://{tenant}.example.com"), "example.com");
		assert.equal(
			studioDomain("https://{tenant}-ink.example.com"),
			"example.com",
		);
		assert.equal(
			studioDomain("https://ink-{tenant}.studios.example.com:8443/ignored"),
			"studios.example.com",
		);
		assert.equal(studioDomain("http://{tenant}.localhost:3000"), "localhost");
		assert.equal(studioDomain("https://{tenant}.example.com."), "example.com");
	});
});
