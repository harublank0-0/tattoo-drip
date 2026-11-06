import { test } from "@japa/runner";
import { browserOriginPolicy } from "#services/browser_origins";

const allowed = browserOriginPolicy({
	appUrl: "https://app.tattoodrip.app",
	discoverUrl: "https://tattoodrip.app",
	storefrontTemplate: "https://{tenant}.tattoodrip.page",
});

test.group("The API's browser origins (Discover D01)", () => {
	test("every studio page, the dashboard and Discover", ({ assert }) => {
		for (const origin of [
			"https://blackneedle.tattoodrip.page",
			"https://ink-house-2.tattoodrip.page",
			"https://123.tattoodrip.page",
			`https://${"a".repeat(63)}.tattoodrip.page`,
			"https://app.tattoodrip.app",
			"https://tattoodrip.app",
		]) {
			assert.isTrue(allowed(origin), origin);
		}
	});

	test("nothing else", ({ assert }) => {
		for (const origin of [
			"https://tattoodrip.page",
			"https://www.tattoodrip.page.evil.example",
			"https://blackneedle.tattoodrip.page.evil.example",
			"https://x.blackneedle.tattoodrip.page",
			"http://blackneedle.tattoodrip.page",
			"https://blackneedle.tattoodrip.page:8443",
			"https://BlackNeedle.tattoodrip.page",
			"https://-needle.tattoodrip.page",
			"https://ab.tattoodrip.page".replace("ab", "a"),
			`https://${"a".repeat(64)}.tattoodrip.page`,
			"https://blackneedletattoodrip.page",
			"https://api.tattoodrip.app",
			"https://evil.tattoodrip.app",
			"http://tattoodrip.app",
			"https://evil.example",
			"null",
			"",
			"*",
		]) {
			assert.isFalse(allowed(origin), origin);
		}
	});

	test("without Discover, only the studio pages and the dashboard", ({
		assert,
	}) => {
		const live = browserOriginPolicy({
			appUrl: "https://tattoodrip.app",
			storefrontTemplate: "https://{tenant}.tattoodrip.page",
		});

		assert.isTrue(live("https://blackneedle.tattoodrip.page"));
		assert.isTrue(live("https://tattoodrip.app"));
		assert.isFalse(live("https://app.tattoodrip.app"));
	});

	test("the development template keeps its scheme and port", ({ assert }) => {
		const dev = browserOriginPolicy({
			appUrl: "http://localhost:3333",
			storefrontTemplate: "http://{tenant}.localhost:3000",
		});

		assert.isTrue(dev("http://blackneedle.localhost:3000"));
		assert.isTrue(dev("http://localhost:3333"));
		assert.isFalse(dev("http://blackneedle.localhost:3001"));
		assert.isFalse(dev("http://localhost:3000"));
	});

	test("a template with text around {tenant} matches only that shape", ({
		assert,
	}) => {
		const suffixed = browserOriginPolicy({
			appUrl: "https://app.example.com",
			storefrontTemplate: "https://{tenant}-ink.example-studios.com",
		});

		assert.isTrue(suffixed("https://needle-ink.example-studios.com"));
		assert.isFalse(suffixed("https://needle.example-studios.com"));
		assert.isFalse(suffixed("https://needle-inkxexample-studios.com"));
	});
});
