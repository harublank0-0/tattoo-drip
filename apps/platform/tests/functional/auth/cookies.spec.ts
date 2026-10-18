import { configProvider } from "@adonisjs/core";
import app from "@adonisjs/core/services/app";
import testUtils from "@adonisjs/core/services/test_utils";
import type { Assert } from "@japa/assert";
import { test } from "@japa/runner";
import User from "#models/user";
import { cookieAttributes, sessionCookieName } from "#services/cookie_policy";
import { parseSetCookie, setCookieLines } from "#tests/helpers/cookies";

/**
 * Japa runs with NODE_ENV=test, so everything here is the development half
 * of the policy: `td-session`, and no Secure (plain http). Production's
 * name, Secure and lines come from the real config files in a process of
 * its own: production_boot.spec.ts.
 */
const SESSION = sessionCookieName(false);

/**
 * Every cookie the dashboard sets (TAT-9 spec, ruling 3). A new one fails
 * the guard below: give it the cookie policy, a row in the spec's cookie
 * table, and a place here.
 */
const KNOWN = [SESSION, "XSRF-TOKEN", "remember_web"];

const EMAIL = "owner@cookies-td9.example";
const PASSWORD = "secret-password";

/**
 * Asserts the policy on every Set-Cookie line of a dashboard response and
 * returns the cookies' names.
 */
function assertPolicy(assert: Assert, header: unknown): string[] {
	const lines = setCookieLines(header);
	assert.isAbove(lines.length, 0, "the response sets no cookie");
	for (const line of lines) {
		const { name, attributes } = parseSetCookie(line);
		assert.include(KNOWN, name, `${name} is not a known cookie`);
		assert.isUndefined(
			attributes.find((attribute) => attribute.startsWith("domain=")),
			`${name} names a Domain`,
		);
		assert.include(attributes, "path=/", name);
		assert.include(attributes, "samesite=lax", name);
		assert.isFalse(
			attributes.includes("secure"),
			`${name}: no Secure over the tests' plain http`,
		);
		assert.equal(
			attributes.includes("httponly"),
			name !== "XSRF-TOKEN",
			`${name}: HttpOnly on all but XSRF-TOKEN`,
		);
	}
	return lines.map((line) => parseSetCookie(line).name);
}

test.group("Dashboard cookies (TAT-9)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("every cookie the dashboard sets is host-only, on /, SameSite=Lax and, over the tests' http, not Secure", async ({
		client,
		assert,
	}) => {
		const user = await User.create({ email: EMAIL, password: PASSWORD });

		const page = await client.get("/login");
		page.assertStatus(200);
		assert.includeMembers(assertPolicy(assert, page.headers()["set-cookie"]), [
			SESSION,
			"XSRF-TOKEN",
		]);

		const login = await client
			.post("/login")
			.form({ email: EMAIL, password: PASSWORD })
			.withCsrfToken()
			.redirects(0);
		login.assertStatus(302);
		assert.includeMembers(assertPolicy(assert, login.headers()["set-cookie"]), [
			SESSION,
			"XSRF-TOKEN",
			"remember_web",
		]);

		const dashboard = await client.get("/dashboard").loginAs(user).redirects(0);
		dashboard.assertStatus(302);
		assert.include(
			assertPolicy(assert, dashboard.headers()["set-cookie"]),
			SESSION,
		);

		const logout = await client
			.post("/logout")
			.withCsrfToken()
			.loginAs(user)
			.redirects(0);
		logout.assertStatus(302);
		assert.includeMembers(
			assertPolicy(assert, logout.headers()["set-cookie"]),
			[SESSION, "remember_web"],
		);
	});

	test("the resolved session and cookie configs follow the policy and name no domain", async ({
		assert,
	}) => {
		assert.isFalse(app.inProduction, "the suite runs as NODE_ENV=test");
		const session = await configProvider.resolve<{
			cookieName: string;
			cookie: Record<string, unknown>;
		}>(app, app.config.get("session"));
		assert.equal(session?.cookieName, SESSION);
		assert.containSubset(session?.cookie, { ...cookieAttributes(false) });
		assert.notProperty(session?.cookie, "domain");

		const http = app.config.get<{ cookie: Record<string, unknown> }>(
			"app.http",
		);
		assert.containSubset(http.cookie, { ...cookieAttributes(false) });
		assert.notProperty(http.cookie, "domain");
	});

	test("signing in issues a new session id, so a planted one never carries the login", async ({
		client,
		assert,
	}) => {
		await User.create({ email: EMAIL, password: PASSWORD });
		const request = client
			.post("/login")
			.form({ email: EMAIL, password: PASSWORD })
			.withCsrfToken()
			.redirects(0);
		// The session plugin's client is one per request: this is the id the
		// request sends in its session cookie.
		const planted = request.sessionClient.sessionId;

		const response = await request;

		response.assertStatus(302);
		response.assertHeader("location", "/dashboard");
		const issued = response.cookie(SESSION)?.value;
		assert.isString(issued);
		assert.notEqual(issued, planted);
	});
});
