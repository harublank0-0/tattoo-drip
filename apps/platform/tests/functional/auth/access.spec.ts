import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import User from "#models/user";

test.group("Auth access", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("shows the login page to guests", async ({ client }) => {
		const response = await client.get("/login");

		response.assertStatus(200);
	});

	test("sends guests from the dashboard to the login page", async ({
		client,
	}) => {
		const response = await client.get("/dashboard").redirects(0);

		response.assertStatus(302);
		response.assertHeader("location", "/login");
	});

	test("lets a signed-in user open the dashboard", async ({ client }) => {
		const user = await User.create({
			email: "ink@example.com",
			password: "secret-password",
		});

		const response = await client.get("/dashboard").loginAs(user);

		response.assertStatus(200);
	});
});
