import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import User from "#models/user";
import {
	assertApiData,
	assertApiHeaders,
	assertNoCookies,
} from "#tests/helpers/api";

const signedIn = () =>
	User.create({ email: "owner@example.com", password: "secret-password" });

test.group("Public API: stateless and cookieless", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("answers with { data }, the API headers and no cookie, even with a dashboard session", async ({
		client,
	}) => {
		const response = await client
			.get("/api/v1/__test/ok")
			.loginAs(await signedIn());

		assertApiData(response, { ok: true });
		assertApiHeaders(response);
		response.assertHeader("cache-control", "no-store");
	});

	test("a POST needs no CSRF token and sets no cookie", async ({ client }) => {
		const response = await client
			.post("/api/v1/__test/echo")
			.json({ label: "Hello" })
			.loginAs(await signedIn());

		assertApiData(response, { label: "Hello" });
		assertApiHeaders(response);
	});

	test("HEAD answers without a body or a cookie", async ({ client }) => {
		const response = await client.head("/api/v1/__test/ok");

		response.assertStatus(200);
		assertNoCookies(response);
	});

	test("an Inertia header on an API request changes nothing", async ({
		client,
	}) => {
		const response = await client
			.get("/api/v1/__test/ok")
			.header("x-inertia", "true")
			.header("x-inertia-version", "stale");

		assertApiData(response, { ok: true });
		assertApiHeaders(response);
	});

	test("the dashboard still gets its session and CSRF cookies", async ({
		client,
		assert,
	}) => {
		const response = await client.get("/login");

		response.assertStatus(200);
		const cookies = String(response.headers()["set-cookie"]);
		assert.include(cookies, "adonis-session=");
		assert.include(cookies, "XSRF-TOKEN=");
	});
});
