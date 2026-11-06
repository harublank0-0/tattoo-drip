import { test } from "@japa/runner";
import { boot } from "#tests/helpers/boot";

/**
 * What production requires besides APP_URL and STOREFRONT_URL, which each
 * test sets. Every other setting comes from the platform's `.env`, as in
 * role_guard.spec.ts. The R2 values are made up and well formed: production
 * refuses the local photo folders (TAT-27), and `.env.test` blanks R2 for the
 * tests. Booting never calls R2.
 */
const PRODUCTION = {
	NODE_ENV: "production",
	TURNSTILE_SECRET_KEY: "test-secret-td9",
	STOREFRONT_SERVER_KEYS:
		"td9-test-key-one-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa,td9-test-key-two-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
	TRUST_PROXY: "loopback",
	R2_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
	R2_ACCESS_KEY_ID: "td9-test-access-key",
	R2_SECRET_ACCESS_KEY: "td9-test-secret-key",
	R2_PUBLIC_BUCKET: "td9-test-public",
	R2_PRIVATE_BUCKET: "td9-test-private",
	R2_PUBLIC_URL: "https://media.tattoodrip.app",
	// .env.test's development values reach the child through the environment:
	// the live layout sets neither (a test that needs them sets both).
	API_URL: "",
	DISCOVER_URL: "",
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

/** The D11 layout (docs/discover/domain-migration.md), on made-up domains. */
const SPLIT = {
	APP_URL: "https://app.tattoodrip.app",
	API_URL: "https://api.tattoodrip.app",
	DISCOVER_URL: "https://tattoodrip.app",
	STOREFRONT_URL: "https://{tenant}.tattoodrip.studio",
};

test.group("Production boot: the split hosts (Discover D01)", () => {
	test("the D11 layout boots", async ({ assert }) => {
		const { exitCode, killed, output } = await boot(["ace.js", "list:routes"], {
			...PRODUCTION,
			...SPLIT,
		});

		assert.isFalse(killed);
		assert.equal(exitCode, 0, output);
	}).timeout(40_000);

	test("an http API_URL or DISCOVER_URL stops the app", async ({ assert }) => {
		for (const [key, value] of [
			["API_URL", "http://api.tattoodrip.app"],
			["DISCOVER_URL", "http://tattoodrip.app"],
		]) {
			const { exitCode, killed, output } = await boot(
				["ace.js", "list:routes"],
				{ ...PRODUCTION, ...SPLIT, [key]: value },
			);

			assert.isFalse(killed, key);
			assert.equal(exitCode, 1, key);
			assert.include(output, `${key} must be an https origin in production`);
		}
	}).timeout(80_000);

	test("an API on the studio pages' domain, or Discover on the dashboard's host, stops the app", async ({
		assert,
	}) => {
		for (const [settings, message] of [
			[
				{ API_URL: "https://api.tattoodrip.studio" },
				/API_URL \(api\.tattoodrip\.studio\) and the studio pages .* must be on separate domains/,
			],
			[
				{ DISCOVER_URL: "https://app.tattoodrip.app" },
				/DISCOVER_URL \(app\.tattoodrip\.app\) must be a host of its own/,
			],
		] as const) {
			const { exitCode, killed, output } = await boot(
				["ace.js", "list:routes"],
				{ ...PRODUCTION, ...SPLIT, ...settings },
			);

			assert.isFalse(killed);
			assert.equal(exitCode, 1);
			assert.match(output, message);
		}
	}).timeout(80_000);
});

/** What tests/helpers/print_cookie_config.ts prints before its JSON. */
const PRINTED = "COOKIE_CONFIG=";

type PrintedCookies = {
	inProduction: boolean;
	session: { cookieName: string; cookie: Record<string, unknown> };
	http: { cookie: Record<string, unknown> };
	lines: { session: string; data: string; xsrf: string; cleared: string };
};

test.group("Production boot: the real cookie wiring (TAT-9)", () => {
	test("config/session.ts and config/app.ts give production's cookies their name and attributes", async ({
		assert,
	}) => {
		// NODE_ENV=test makes every other test see the development half of the
		// policy, so this is the only place the two config files run as
		// production: one real boot, no database.
		const { exitCode, killed, output } = await boot(
			["--import", "@poppinss/ts-exec", "tests/helpers/print_cookie_config.ts"],
			{ ...PRODUCTION, ...APART },
		);

		assert.isFalse(killed);
		assert.equal(exitCode, 0, output);
		const printed = output.split("\n").find((line) => line.startsWith(PRINTED));
		assert.isString(printed, output);
		const { inProduction, session, http, lines } = JSON.parse(
			(printed as string).slice(PRINTED.length),
		) as PrintedCookies;

		assert.isTrue(inProduction);
		assert.equal(session.cookieName, "__Host-td-session");
		// The session cookie's options, which the cookie store's data cookie
		// takes as well, and the defaults of every other cookie.
		const host = { path: "/", httpOnly: true, secure: true, sameSite: "lax" };
		for (const [name, cookie] of [
			["session", session.cookie],
			["http", http.cookie],
		] as const) {
			assert.containSubset(cookie, host, name);
			assert.notProperty(cookie, "domain", name);
		}

		// The lines the real serializer writes from those configs. A Domain,
		// or a missing Secure on a __Host- name, would have made it throw.
		assert.match(
			lines.session,
			/^__Host-td-session=[^;]+; Max-Age=7200; Path=\/; HttpOnly; Secure; SameSite=Lax$/,
		);
		assert.match(
			lines.data,
			/^[^=]+=[^;]+; Max-Age=7200; Path=\/; HttpOnly; Secure; SameSite=Lax$/,
		);
		assert.match(
			lines.xsrf,
			/^XSRF-TOKEN=[^;]+; Max-Age=7200; Path=\/; Secure; SameSite=Lax$/,
		);
		assert.match(
			lines.cleared,
			/^remember_web=; Max-Age=0; Path=\/; Expires=[^;]+; HttpOnly; Secure; SameSite=Lax$/,
		);
	}).timeout(40_000);
});
