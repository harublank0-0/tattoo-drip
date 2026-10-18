import { test } from "@japa/runner";
import { boot } from "#tests/helpers/boot";

/**
 * What production requires besides APP_URL and STOREFRONT_URL, which each
 * test sets. Every other setting comes from the platform's `.env`, as in
 * role_guard.spec.ts.
 */
const PRODUCTION = {
	NODE_ENV: "production",
	TURNSTILE_SECRET_KEY: "test-secret-td9",
	STOREFRONT_SERVER_KEYS:
		"td9-test-key-one-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa,td9-test-key-two-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
	TRUST_PROXY: "loopback",
};

const APART = {
	APP_URL: "https://app.tattoodrip.app",
	STOREFRONT_URL: "https://{tenant}.tattoodrip.studio",
};

test.group("Production boot: the dashboard's origin (TAT-9)", () => {
	test("an http APP_URL stops the web server before it listens", async ({
		assert,
	}) => {
		const { exitCode, killed, output } = await boot(
			["--import", "@poppinss/ts-exec", "bin/server.ts"],
			{ ...PRODUCTION, ...APART, APP_URL: "http://app.tattoodrip.app" },
		);

		assert.isFalse(killed);
		assert.equal(exitCode, 1);
		assert.match(output, /APP_URL must be an https URL in production/);
		assert.notMatch(output, /started HTTP server/);
	}).timeout(40_000);

	test("an APP_URL on the studio pages' domain stops ace commands", async ({
		assert,
	}) => {
		const { exitCode, killed, output } = await boot(["ace.js", "list:routes"], {
			...PRODUCTION,
			APP_URL: "https://app.example.com",
			STOREFRONT_URL: "https://{tenant}.example.com",
		});

		assert.isFalse(killed);
		assert.equal(exitCode, 1);
		assert.match(output, /must be on separate domains in production/);
	}).timeout(40_000);

	test("separate https origins boot", async ({ assert }) => {
		const { exitCode, killed, output } = await boot(["ace.js", "list:routes"], {
			...PRODUCTION,
			...APART,
		});

		assert.isFalse(killed);
		assert.equal(exitCode, 0, output);
	}).timeout(40_000);
});
