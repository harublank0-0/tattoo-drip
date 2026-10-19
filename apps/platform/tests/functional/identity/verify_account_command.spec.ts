import ace from "@adonisjs/core/services/ace";
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import User from "#models/user";
import AccountTokenService from "#modules/identity/services/account_token_service";
// No #commands alias exists (and package.json stays as it is), so the
// command is imported by path.
import VerifyAccount from "../../../commands/verify_account.js";

const tokens = new AccountTokenService();

test.group("account:verify (TAT-18)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.setup(() => {
		ace.ui.switchMode("raw");
		return () => ace.ui.switchMode("normal");
	});

	test("confirms an account's address and kills its confirmation link", async ({
		assert,
	}) => {
		const user = await User.create({
			email: "pilot@command-18.example",
			password: "secret-password",
		});
		const token = await tokens.issue(user, "verify_email");

		const command = await ace.create(VerifyAccount, [
			" Pilot@Command-18.example ",
		]);
		await command.exec();

		command.assertSucceeded();
		command.assertLogMatches(
			/Confirmed\. The account can now set up a studio\./,
		);
		assert.isNotNull((await User.findOrFail(user.id)).emailVerifiedAt);
		assert.equal((await tokens.state(token, "verify_email")).state, "unknown");
	});

	test("says so when the address is already confirmed", async ({ assert }) => {
		const user = await User.create({
			email: "done@command-18.example",
			password: "secret-password",
		});
		await (await ace.create(VerifyAccount, [user.email])).exec();

		const again = await ace.create(VerifyAccount, [user.email]);
		await again.exec();

		again.assertSucceeded();
		again.assertLogMatches(/That address is already confirmed\./);
		assert.isNotNull((await User.findOrFail(user.id)).emailVerifiedAt);
	});

	test("fails for an address no account uses", async () => {
		const command = await ace.create(VerifyAccount, [
			"nobody@command-18.example",
		]);
		await command.exec();

		command.assertFailed();
		command.assertLogMatches(/No account uses that address\./);
	});
});
