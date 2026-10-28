import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import User from "#models/user";
import { caseRequest } from "#tests/helpers/isolation";
import { twoStudios } from "#tests/helpers/tenants";
import { isolationCases } from "#tests/isolation/cases";

/**
 * Inertia's history flags (TAT-82). Requests name their Host, so the
 * result doesn't depend on HOST in .env.
 */
const LOCAL = "localhost:3402";

/** A confirmed account: /onboarding is a signed-in page it may open (TAT-18). */
function makeUser() {
	return User.create({
		email: "ink@example.com",
		password: "secret-password",
		emailVerifiedAt: DateTime.now(),
	});
}

test.group("Page history", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("encrypts history on guest and signed-in pages", async ({
		client,
		assert,
	}) => {
		const user = await makeUser();

		const login = await client
			.get("/login")
			.header("host", LOCAL)
			.withInertia();
		const onboarding = await client
			.get("/onboarding")
			.header("host", LOCAL)
			.withInertia()
			.loginAs(user);

		login.assertInertiaComponent("auth/login");
		assert.isTrue(login.body().encryptHistory);
		onboarding.assertInertiaComponent("onboarding/create_tenant");
		assert.isTrue(onboarding.body().encryptHistory);
	});

	test("in development, plain HTTP from another device isn't encrypted", async ({
		client,
		assert,
	}) => {
		const lan = await client
			.get("/login")
			.header("host", "192.168.1.20:3402")
			.withInertia();
		const loopback = await client
			.get("/login")
			.header("host", "127.0.0.1:3402")
			.withInertia();

		lan.assertInertiaComponent("auth/login");
		assert.notProperty(lan.body(), "encryptHistory");
		assert.isTrue(loopback.body().encryptHistory);
	});

	test("every guest page clears history", async ({ client, assert }) => {
		for (const [path, component] of [
			["/login", "auth/login"],
			["/signup", "auth/signup"],
			["/forgot-password", "auth/forgot_password"],
			["/forgot-password/sent", "auth/check_email"],
			["/signup/sent", "auth/check_email"],
			["/reset-password", "auth/reset_password"],
		] as const) {
			const page = await client.get(path).withInertia();

			page.assertInertiaComponent(component);
			assert.isTrue(page.body().clearHistory, path);
		}
	});

	test("logging out lands on the login page, which clears history", async ({
		client,
		assert,
	}) => {
		const user = await makeUser();

		const logout = await client
			.post("/logout")
			.withCsrfToken()
			.loginAs(user)
			.redirects(0);

		logout.assertStatus(302);
		logout.assertHeader("location", "/login");
		const login = await client.get("/login").withInertia();
		assert.isTrue(login.body().clearHistory);
	});

	test("the confirmation pages don't clear history: they sign nobody in or out", async ({
		client,
		assert,
	}) => {
		const user = await User.create({
			email: "new@history-18.example",
			password: "secret-password",
		});

		const verify = await client.get("/verify-email").withInertia();
		verify.assertInertiaComponent("auth/verify_email");
		assert.notProperty(verify.body(), "clearHistory");

		const notice = await client
			.get("/confirm-email")
			.withInertia()
			.loginAs(user);
		notice.assertInertiaComponent("auth/confirm_email");
		assert.notProperty(notice.body(), "clearHistory");
	});

	test("signed-in pages don't clear history", async ({ client, assert }) => {
		const user = await makeUser();

		const onboarding = await client
			.get("/onboarding")
			.withInertia()
			.loginAs(user);

		onboarding.assertInertiaComponent("onboarding/create_tenant");
		assert.notProperty(onboarding.body(), "clearHistory");
	});
});

test.group("Signed-in pages are never stored (TAT-16)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("every page a signed-in owner opens answers private, no-store", async ({
		client,
		assert,
	}) => {
		const { a } = await twoStudios();
		let pages = 0;

		for (const isolationCase of isolationCases) {
			if (isolationCase.method !== "GET") continue;
			const response = await caseRequest(client, isolationCase, a, a, a.owner);
			response.assertStatus(isolationCase.ownStatus);
			if (isolationCase.ownStatus !== 200) continue;
			pages += 1;
			assert.include(
				response.header("cache-control"),
				"no-store",
				isolationCase.pattern,
			);
			// The Members page sets no-store itself; every other page gets this one.
			if (isolationCase.pattern !== "/t/:tenant/settings/members") {
				assert.equal(
					response.header("cache-control"),
					"private, no-store",
					isolationCase.pattern,
				);
			}
		}
		assert.isAbove(pages, 20, "the walk found the pages");
	});

	test("full page loads and Inertia visits both carry it, with or without a studio", async ({
		client,
		assert,
	}) => {
		const { a } = await twoStudios();
		const user = await makeUser();

		const visit = await client
			.get(`/t/${a.tenant.slug}/today`)
			.withInertia()
			.loginAs(a.owner);
		const load = await client.get(`/t/${a.tenant.slug}/today`).loginAs(a.owner);
		const onboarding = await client
			.get("/onboarding")
			.withInertia()
			.loginAs(user);

		for (const response of [visit, load, onboarding]) {
			response.assertStatus(200);
			assert.equal(response.header("cache-control"), "private, no-store");
		}
	});

	test("a page the controller already marked no-store keeps its value", async ({
		client,
		assert,
	}) => {
		const { a } = await twoStudios();

		const members = await client
			.get(`/t/${a.tenant.slug}/settings/members`)
			.withInertia()
			.loginAs(a.owner);

		members.assertStatus(200);
		assert.include(members.header("cache-control"), "no-store");
	});

	test("guest pages and the sign-in page get nothing from this rule", async ({
		client,
		assert,
	}) => {
		const login = await client.get("/login").withInertia();

		login.assertStatus(200);
		assert.notInclude(login.header("cache-control") ?? "", "no-store");
	});
});
