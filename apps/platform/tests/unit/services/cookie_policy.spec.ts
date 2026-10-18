import { ResponseFactory } from "@adonisjs/core/factories/http";
import { test } from "@japa/runner";
import {
	cookieAttributes,
	SESSION_COOKIE,
	sessionCookieName,
} from "#services/cookie_policy";
import { setCookieLines } from "#tests/helpers/cookies";

/**
 * A response with production's cookie defaults (config/app.ts with
 * NODE_ENV=production), written by the real serializer. Tests never run in
 * production, so this is where production's Set-Cookie lines are checked.
 */
function productionResponse() {
	return new ResponseFactory()
		.merge({ config: { cookie: { ...cookieAttributes(true), maxAge: "2h" } } })
		.create();
}

test.group("Cookie policy (TAT-9)", () => {
	test("production: __Host-td-session, Secure, HttpOnly, SameSite=Lax, on /, no domain", ({
		assert,
	}) => {
		assert.equal(SESSION_COOKIE, "td-session");
		assert.equal(sessionCookieName(true), "__Host-td-session");
		assert.deepEqual(
			{ ...cookieAttributes(true) },
			{ path: "/", httpOnly: true, secure: true, sameSite: "lax" },
		);
	});

	test("development and tests: td-session, the same without Secure", ({
		assert,
	}) => {
		assert.equal(sessionCookieName(false), "td-session");
		assert.deepEqual(
			{ ...cookieAttributes(false) },
			{ path: "/", httpOnly: true, secure: false, sameSite: "lax" },
		);
	});

	test("the real serializer writes production's session and XSRF-TOKEN lines exactly", ({
		assert,
	}) => {
		const response = productionResponse();
		response.cookie(sessionCookieName(true), "a-session-id", {
			...cookieAttributes(true),
			maxAge: "2h",
		});
		// What Shield's CSRF guard does on every dashboard response.
		response.encryptedCookie("XSRF-TOKEN", "a-token", { httpOnly: false });

		const [session, xsrf] = setCookieLines(response.getHeader("set-cookie"));
		assert.match(
			session,
			/^__Host-td-session=[^;]+; Max-Age=7200; Path=\/; HttpOnly; Secure; SameSite=Lax$/,
		);
		assert.match(
			xsrf,
			/^XSRF-TOKEN=[^;]+; Max-Age=7200; Path=\/; Secure; SameSite=Lax$/,
		);
	});

	test("in production a Domain, or a missing Secure, makes the serializer throw for the session cookie", ({
		assert,
	}) => {
		const response = productionResponse();
		assert.throws(
			() =>
				response.cookie(sessionCookieName(true), "an-id", {
					...cookieAttributes(true),
					domain: "example.com",
				}),
			/Domain/,
		);
		assert.throws(
			() =>
				response.cookie(sessionCookieName(true), "an-id", {
					...cookieAttributes(false),
				}),
			/Secure/,
		);
	});
});
