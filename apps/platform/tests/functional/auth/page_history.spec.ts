import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import User from "#models/user";

/**
 * Inertia's history flags (TAT-82). Requests name their Host, so the
 * result doesn't depend on HOST in .env.
 */
const LOCAL = "localhost:3402";

function makeUser() {
	return User.create({ email: "ink@example.com", password: "secret-password" });
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

	test("the login and signup pages clear history", async ({
		client,
		assert,
	}) => {
		const login = await client.get("/login").withInertia();
		const signup = await client.get("/signup").withInertia();

		login.assertInertiaComponent("auth/login");
		assert.isTrue(login.body().clearHistory);
		signup.assertInertiaComponent("auth/signup");
		assert.isTrue(signup.body().clearHistory);
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
