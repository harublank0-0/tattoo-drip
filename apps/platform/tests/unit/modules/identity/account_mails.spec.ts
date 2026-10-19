import { test } from "@japa/runner";
import { DateTime } from "luxon";
import AccountExistsMail from "#modules/identity/emails/account_exists_mail";
import PasswordChangedMail, {
	changedAtText,
} from "#modules/identity/emails/password_changed_mail";
import ResetPasswordMail from "#modules/identity/emails/reset_password_mail";

const TO = "ink@example.com";
const SIGN_IN = "https://app.tattoo-drip.test/login";
const RESET = "https://app.tattoo-drip.test/reset-password/abc";
const FORGOT = "https://app.tattoo-drip.test/forgot-password";

test.group("Account mails", () => {
	test("an address that already has an account gets a sign-in and a reset link", async ({
		assert,
	}) => {
		const mail = new AccountExistsMail({
			to: TO,
			signInUrl: SIGN_IN,
			resetUrl: RESET,
		});
		await mail.buildWithContents();
		const { message } = mail;

		message.assertTo(TO);
		message.assertSubject("You already have a Tattoo Drip account");
		assert.isUndefined(message.nodeMailerMessage.from);
		message.assertHtmlIncludes("Hello,");
		message.assertHtmlIncludes(`href="${SIGN_IN}"`);
		message.assertHtmlIncludes(`href="${RESET}"`);
		message.assertTextIncludes(SIGN_IN);
		message.assertTextIncludes(RESET);
		message.assertTextIncludes("your account hasn't changed");
	});

	test("a reset link works for an hour, once", async ({ assert }) => {
		const mail = new ResetPasswordMail({ to: TO, url: RESET });
		await mail.buildWithContents();
		const { message } = mail;

		message.assertTo(TO);
		message.assertSubject("Choose a new password");
		assert.isUndefined(message.nodeMailerMessage.from);
		message.assertHtmlIncludes(`href="${RESET}"`);
		message.assertTextIncludes(RESET);
		message.assertTextIncludes("It works for 1 hour, once.");
	});

	test("the password-changed notice names the time and links to a new request, never a token", async () => {
		const mail = new PasswordChangedMail({
			to: TO,
			changedAt: "19 Oct 2026 at 14:05 UTC",
			resetUrl: FORGOT,
		});
		await mail.buildWithContents();
		const { message } = mail;

		message.assertTo(TO);
		message.assertSubject("Your Tattoo Drip password was changed");
		message.assertHtmlIncludes("19 Oct 2026 at 14:05 UTC");
		message.assertHtmlIncludes(`href="${FORGOT}"`);
		message.assertTextIncludes(FORGOT);
		message.assertTextIncludes(
			"every device that was signed in was signed out",
		);
	});

	test("the change time is written in UTC", ({ assert }) => {
		assert.equal(
			changedAtText(DateTime.fromISO("2026-10-19T14:05:00Z")),
			"19 Oct 2026 at 14:05 UTC",
		);
		assert.equal(
			changedAtText(DateTime.fromISO("2026-10-19T19:50:00+05:45")),
			"19 Oct 2026 at 14:05 UTC",
		);
	});
});
