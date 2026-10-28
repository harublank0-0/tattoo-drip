import testUtils from "@adonisjs/core/services/test_utils";
import type { ApiClient, ApiResponse } from "@japa/api-client";
import { test } from "@japa/runner";
import User from "#models/user";
import { SESSION_TOKEN_KEYS } from "#modules/identity/account_tokens";
import AccountTokenService from "#modules/identity/services/account_token_service";
import { flowOf } from "#tests/helpers/accounts";

/**
 * What a refused account form leaves in the session's flash (TAT-95 fix round
 * 1). A plain HTML form post (no X-Inertia header, a browser without
 * JavaScript or a hand-made client) is flashed back with what was typed, so
 * the form can show it again; a password must never be part of that, whatever
 * the field is called (the session package alone leaves out only `password`
 * and `password_confirmation`). The Inertia flavour flashes no input at all.
 */
const PASSWORD_FIELDS = ["password", "passwordConfirmation", "currentPassword"];
const OLD = "the-old-password";
const tokens = new AccountTokenService();

/** The flash holds no password field, under any key. */
function assertNoPasswords(response: ApiResponse) {
	const flashed = response.flashMessages();
	for (const field of PASSWORD_FIELDS) {
		response.assert?.notProperty(flashed, field, `${field} was flashed`);
	}
	// And no password value, whatever key it hides under.
	response.assert?.notInclude(
		JSON.stringify(flashed),
		"typed-secret",
		"a typed password is in the flash",
	);
}

function plainPost(client: ApiClient, path: string, body: object, ip: string) {
	return client
		.post(path)
		.header("referer", path)
		.header("x-forwarded-for", ip)
		.form(body)
		.withCsrfToken()
		.redirects(0);
}

test.group(
	"Refused account forms keep no password in the flash (TAT-95)",
	(group) => {
		group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

		test("a plain signup that fails validation keeps the typed email and name but no password", async ({
			client,
			assert,
		}) => {
			const response = await plainPost(
				client,
				"/signup",
				{
					fullName: "Ada Ink",
					email: "ada@flash-95.example",
					password: "typed-secret",
					passwordConfirmation: "typed-secret-other",
				},
				"203.0.113.161",
			);

			response.assertStatus(302);
			assert.property(
				response.flashMessage("inputErrorsBag"),
				"passwordConfirmation",
			);
			assert.equal(response.flashMessage("email"), "ada@flash-95.example");
			assert.equal(response.flashMessage("fullName"), "Ada Ink");
			assertNoPasswords(response);
		});

		test("a plain sign-in that fails validation keeps the typed email but no password", async ({
			client,
			assert,
		}) => {
			const response = await plainPost(
				client,
				"/login",
				{ email: "not-an-email", password: "typed-secret" },
				"203.0.113.162",
			);

			response.assertStatus(302);
			assert.equal(response.flashMessage("email"), "not-an-email");
			assertNoPasswords(response);
		});

		test("a plain reset that fails validation keeps nothing secret", async ({
			client,
			assert,
		}) => {
			const user = await User.create({
				email: "reset@flash-95.example",
				password: OLD,
			});
			const token = await tokens.issue(user, "reset_password");
			const flow = await flowOf(token);

			const response = await client
				.post("/reset-password")
				.header("referer", "/reset-password")
				.header("x-forwarded-for", "203.0.113.163")
				.withSession({ [SESSION_TOKEN_KEYS.reset_password]: token })
				.form({
					password: "typed-secret",
					passwordConfirmation: "typed-secret-other",
					flow,
				})
				.withCsrfToken()
				.redirects(0);

			response.assertStatus(302);
			assert.property(
				response.flashMessage("inputErrorsBag"),
				"passwordConfirmation",
			);
			// What is not secret is still kept: the page's own flow id.
			assert.equal(response.flashMessage("flow"), flow);
			assertNoPasswords(response);
		});

		test("a plain account-page post with the right current password but a bad new one keeps no password", async ({
			client,
			assert,
		}) => {
			const user = await User.create({
				email: "account@flash-95.example",
				password: OLD,
			});

			const response = await client
				.put("/account/password")
				.header("referer", "/account")
				.header("x-forwarded-for", "203.0.113.164")
				.form({
					currentPassword: OLD,
					password: "typed-secret",
					passwordConfirmation: "typed-secret-other",
				})
				.withCsrfToken()
				.loginAs(user)
				.redirects(0);

			response.assertStatus(302);
			assert.property(
				response.flashMessage("inputErrorsBag"),
				"passwordConfirmation",
			);
			assertNoPasswords(response);
			// The current password is in this body too: it must not be in the flash.
			assert.notInclude(JSON.stringify(response.flashMessages()), OLD);
		});

		test("snake_case and other spellings of a password are kept out of the flash too, nested ones included, while the email stays", async ({
			client,
			assert,
		}) => {
			const secrets = {
				password_confirmation: "typed-secret",
				current_password: "typed-secret",
				new_password: "typed-secret",
				newPassword: "typed-secret",
				newPasswordConfirmation: "typed-secret",
				passcode: "typed-secret",
				user: { password: "typed-secret", name: "kept?" },
				list: [{ passwd: "typed-secret" }],
			};

			const signup = await plainPost(
				client,
				"/signup",
				{
					fullName: "Ada Ink",
					email: "ada@flash-95.example",
					password: "typed-secret",
					passwordConfirmation: "typed-secret-other",
					...secrets,
				},
				"203.0.113.166",
			);
			signup.assertStatus(302);
			assert.equal(signup.flashMessage("email"), "ada@flash-95.example");
			assertNoPasswords(signup);

			const user = await User.create({
				email: "snake@flash-95.example",
				password: OLD,
			});
			const token = await tokens.issue(user, "reset_password");
			const reset = await client
				.post("/reset-password")
				.header("referer", "/reset-password")
				.header("x-forwarded-for", "203.0.113.167")
				.withSession({ [SESSION_TOKEN_KEYS.reset_password]: token })
				.form({
					password: "typed-secret",
					passwordConfirmation: "typed-secret-other",
					flow: await flowOf(token),
					...secrets,
				})
				.withCsrfToken()
				.redirects(0);
			reset.assertStatus(302);
			assertNoPasswords(reset);

			const account = await client
				.put("/account/password")
				.header("referer", "/account")
				.header("x-forwarded-for", "203.0.113.168")
				.form({
					currentPassword: OLD,
					password: "typed-secret",
					passwordConfirmation: "typed-secret-other",
					...secrets,
				})
				.withCsrfToken()
				.loginAs(user)
				.redirects(0);
			account.assertStatus(302);
			assertNoPasswords(account);
		});

		test("a throttled form keeps no password under any spelling either, and still keeps the email", async ({
			client,
			assert,
		}) => {
			const body = {
				email: "nobody@flash-95.example",
				password: "typed-secret",
				password_confirmation: "typed-secret",
				current_password: "typed-secret",
				newPassword: "typed-secret",
				user: { password: "typed-secret" },
			};
			// Ten failed sign-ins from one address use up its allowance.
			for (let i = 0; i < 10; i++) {
				await plainPost(client, "/login", body, "203.0.113.169");
			}

			const refused = await plainPost(client, "/login", body, "203.0.113.169");

			refused.assertStatus(302);
			assert.match(
				String(refused.flashMessage("error")),
				/^Too many attempts\. Try again in \d+ minutes\.$/,
			);
			assert.equal(refused.flashMessage("email"), "nobody@flash-95.example");
			assertNoPasswords(refused);
		});

		test("an Inertia post keeps no input at all, as before", async ({
			client,
			assert,
		}) => {
			const response = await client
				.post("/signup")
				.header("referer", "/signup")
				.header("x-forwarded-for", "203.0.113.165")
				.form({
					fullName: "Ada Ink",
					email: "ada@flash-95.example",
					password: "typed-secret",
					passwordConfirmation: "typed-secret-other",
				})
				.withInertia()
				.withCsrfToken()
				.redirects(0);

			assert.property(
				response.flashMessage("inputErrorsBag"),
				"passwordConfirmation",
			);
			assert.isUndefined(response.flashMessage("email"));
			assertNoPasswords(response);
		});
	},
);
