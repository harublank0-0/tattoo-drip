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
