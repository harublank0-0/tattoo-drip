import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { assertApiError, assertNoCookies } from "#tests/helpers/api";
import { studioWithOwner } from "#tests/helpers/tenants";

/**
 * The API-only hosts (Discover D01, ApiHostMiddleware): .env.test's API_URL
 * (api.localhost) and DISCOVER_URL (discover.localhost). The test client
 * reaches the app on localhost, the dashboard's host, unless a test names
 * another with a Host or X-Forwarded-Host header.
 */
const API_HOST = "api.localhost:3333";
const DISCOVER_HOST = "discover.localhost:3002";

/** Dashboard pages, account links, static files and the dashboard's app shell. */
const NOT_API = [
	"/",
	"/login",
	"/signup",
	"/dashboard",
	"/t/api-needle-32/today",
	"/reset-password/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
	"/sw.js",
	"/manifest.webmanifest",
	"/no-such-page",
];

test.group("API-only hosts (Discover D01)", () => {
	test("the API's own host answers /api", async ({ client, assert }) => {
		const response = await client
			.get("/api/v1/styles")
			.header("host", API_HOST);

		response.assertStatus(200);
		assert.isArray(response.body().data);
		assertNoCookies(response);
	});

	test("the API's own host serves no page, file or cookie: everything else is the API's 404", async ({
		client,
	}) => {
		for (const path of NOT_API) {
			const response = await client.get(path).header("host", API_HOST);

			assertApiError(response, 404, "not_found");
		}
	});

	test("a dashboard write on the API's host is that 404 too, before any CSRF check", async ({
		client,
	}) => {
		const response = await client
			.post("/login")
			.header("host", API_HOST)
			.form({ email: "owner@example.com", password: "secret-password" });

		assertApiError(response, 404, "not_found");
	});

	test("Discover's host answers /api (the legacy proxy) and nothing else", async ({
		client,
	}) => {
		const api = await client
			.get("/api/v1/styles")
			.header("host", DISCOVER_HOST);
		api.assertStatus(200);
		assertNoCookies(api);

		for (const path of NOT_API) {
			const response = await client.get(path).header("host", DISCOVER_HOST);

			assertApiError(response, 404, "not_found");
		}
	});

	test("the host is matched whatever its case and trailing dot", async ({
		client,
	}) => {
		for (const host of ["API.LOCALHOST:3333", "api.localhost.:3333"]) {
			const response = await client.get("/login").header("host", host);

			assertApiError(response, 404, "not_found");
		}
	});

	test("behind a trusted proxy, the forwarded host decides", async ({
		client,
	}) => {
		// The test client is on loopback, which TRUST_PROXY trusts when unset.
		const response = await client
			.get("/login")
			.header("x-forwarded-host", "api.localhost");

		assertApiError(response, 404, "not_found");
	});

	test("the dashboard's host is unchanged: pages, files and the API", async ({
		client,
		assert,
	}) => {
		const login = await client.get("/login");
		login.assertStatus(200);
		assert.isDefined(login.header("set-cookie"));

		(await client.get("/sw.js")).assertStatus(200);
		(await client.get("/api/v1/styles")).assertStatus(200);
	});

	test("a studio page's host is not an API-only host", async ({ client }) => {
		const response = await client
			.get("/login")
			.header("host", "api-needle-32.localhost:3000");

		response.assertStatus(200);
	});
});

test.group("API-only hosts: sessions (Discover D01)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a signed-in member reaches the dashboard on its host, and nothing of it on the API's", async ({
		client,
	}) => {
		const { owner, tenant } = await studioWithOwner("api-host-d01");

		const today = await client
			.get(`/t/${tenant.slug}/today`)
			.loginAs(owner)
			.redirects(0);
		today.assertStatus(200);

		for (const host of [API_HOST, DISCOVER_HOST]) {
			for (const path of [`/t/${tenant.slug}/today`, "/dashboard"]) {
				const response = await client
					.get(path)
					.header("host", host)
					.loginAs(owner)
					.redirects(0);

				assertApiError(response, 404, "not_found");
			}
		}
	});

	test("signed out, the dashboard's host still sends a guest to sign in", async ({
		client,
	}) => {
		const response = await client.get("/dashboard").redirects(0);

		response.assertStatus(302);
		response.assertHeader("location", "/login");
	});
});
