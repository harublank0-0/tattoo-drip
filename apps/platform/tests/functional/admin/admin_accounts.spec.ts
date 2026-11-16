import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import User from "#models/user";
import AccountTokenService from "#modules/identity/services/account_token_service";
import { adminUser } from "#tests/helpers/admin";
import { send, studio } from "#tests/helpers/discover";
import { assertValidationError } from "#tests/helpers/validation";

const tokens = new AccountTokenService();

test.group("Admin accounts", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("confirms an account's address and revokes its confirmation link", async ({
		client,
		assert,
	}) => {
		const admin = await adminUser();
		const user = await User.create({
			email: "pilot@admin-accounts.example",
			password: "secret-password",
		});
		const token = await tokens.issue(user, "verify_email");

		const response = await send(
			client,
			admin,
			"post",
			"/admin/accounts/verify",
			{
				email: " Pilot@Admin-Accounts.example ",
			},
		);

		response.assertStatus(302);
		response.assertFlashMessage(
			"success",
			"Confirmed. The account can now set up a studio.",
		);
		assert.isNotNull((await User.findOrFail(user.id)).emailVerifiedAt);
		assert.equal((await tokens.state(token, "verify_email")).state, "unknown");
	});

	test("says so when the address is already confirmed", async ({ client }) => {
		const admin = await adminUser();
		const response = await send(
			client,
			admin,
			"post",
			"/admin/accounts/verify",
			{
				email: admin.email,
			},
		);

		response.assertStatus(302);
		response.assertFlashMessage(
			"success",
			"That address is already confirmed.",
		);
	});

	test("flashes an error for an address no account uses", async ({
		client,
	}) => {
		const admin = await adminUser();
		const response = await send(
			client,
			admin,
			"post",
			"/admin/accounts/verify",
			{
				email: "nobody@admin-accounts.example",
			},
		);

		response.assertStatus(302);
		response.assertFlashMessage("error", "No account uses that address.");
	});

	test("refuses something that is not an email address", async ({ client }) => {
		const admin = await adminUser();
		const response = await send(
			client,
			admin,
			"post",
			"/admin/accounts/verify",
			{
				email: "not-an-address",
			},
		);

		response.assertStatus(302);
		assertValidationError(response, "email");
	});

	test("the page renders for an admin", async ({ client }) => {
		const admin = await adminUser();
		const response = await client
			.get("/admin/accounts")
			.withInertia()
			.loginAs(admin);
		response.assertStatus(200);
		response.assertInertiaComponent("admin/accounts");
	});

	test("is a 404 for a studio owner", async ({ client }) => {
		const { owner } = await studio("adm-accounts-owner");
		(await client.get("/admin/accounts").loginAs(owner)).assertStatus(404);
		(
			await send(client, owner, "post", "/admin/accounts/verify", {
				email: "x@admin-accounts.example",
			})
		).assertStatus(404);
	});
});
