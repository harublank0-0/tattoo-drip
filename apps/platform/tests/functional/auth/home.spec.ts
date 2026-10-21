import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import User from "#models/user";

test.group("The front door (TAT-100)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a signed-out visitor at / is sent to the login page", async ({
		client,
	}) => {
		const response = await client.get("/").redirects(0);

		response.assertStatus(302);
		response.assertHeader("location", "/login");
	});

	test("a signed-in user at / is sent to the dashboard, which picks their studio", async ({
		client,
	}) => {
		const user = await User.create({
			email: "ink@home-100.example",
			password: "secret-password",
		});

		const response = await client.get("/").loginAs(user).redirects(0);

		response.assertStatus(302);
		response.assertHeader("location", "/dashboard");
	});

	test("following the redirect shows the sign-in page, with no starter-kit text anywhere", async ({
		client,
		assert,
	}) => {
		const response = await client.get("/").withInertia();

		response.assertStatus(200);
		response.assertInertiaComponent("auth/login");
		const html = (await client.get("/")).text();
		for (const starter of [
			"AdonisJS",
			"Welcome to the power",
			"Documentation",
			"Discord",
		]) {
			assert.notInclude(html, starter);
		}
	});

	test("the starter page is gone: nothing renders the 'home' component", async ({
		client,
		assert,
	}) => {
		// An Inertia visit to / ends on a real page, never on "home".
		const response = await client.get("/").withInertia();

		assert.notEqual(response.inertiaComponent, "home");
	});
});
