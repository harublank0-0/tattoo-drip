import testUtils from "@adonisjs/core/services/test_utils";
import type { ApiClient } from "@japa/api-client";
import { test } from "@japa/runner";

/** What a browser sends for blank fields; the body parser turns them into null. */
function post(client: ApiClient, path: string, body: Record<string, string>) {
	return client
		.post(path)
		.header("x-forwarded-for", "203.0.113.200")
		.header("referer", path)
		.form(body)
		.withCsrfToken()
		.redirects(0);
}

function asText(value: unknown) {
	return [value].flat().join(" ");
}

test.group("Account form messages over HTTP (TAT-100)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an empty signup comes back with three human messages and no field names", async ({
		client,
		assert,
	}) => {
		const response = await post(client, "/signup", {
			fullName: "",
			email: "",
			password: "",
			passwordConfirmation: "",
		});

		response.assertHeader("location", "/signup");
		const errors = response.flashMessage("inputErrorsBag") ?? {};
		assert.deepEqual(Object.keys(errors).sort(), [
			"email",
			"password",
			"passwordConfirmation",
		]);
		assert.equal(asText(errors.email), "Enter your email.");
		assert.equal(asText(errors.password), "Enter your password.");
		assert.equal(
			asText(errors.passwordConfirmation),
			"Type your password again.",
		);
	});

	test("an empty login asks for the email and the password", async ({
		client,
		assert,
	}) => {
		const response = await post(client, "/login", { email: "", password: "" });

		response.assertHeader("location", "/login");
		const errors = response.flashMessage("inputErrorsBag") ?? {};
		assert.equal(asText(errors.email), "Enter your email.");
		assert.equal(asText(errors.password), "Enter your password.");
	});

	test("an empty reset request asks for the email", async ({
		client,
		assert,
	}) => {
		const response = await post(client, "/forgot-password", { email: "" });

		response.assertHeader("location", "/forgot-password");
		const errors = response.flashMessage("inputErrorsBag") ?? {};
		assert.equal(asText(errors.email), "Enter your email.");
	});
});
