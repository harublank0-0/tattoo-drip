import emitter from "@adonisjs/core/services/emitter";
import mailer from "@adonisjs/mail/services/main";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import SendMailJob from "#jobs/send_mail_job";
import AccountExistsMail from "#modules/identity/emails/account_exists_mail";
import PasswordChangedMail, {
	changedAtText,
} from "#modules/identity/emails/password_changed_mail";
import ResetPasswordMail from "#modules/identity/emails/reset_password_mail";

const TO = "ink@example.com";
const SIGN_IN = "https://app.tattoo-drip.test/login";
const RESET = "https://app.tattoo-drip.test/reset-password/abc";
const FORGOT = "https://app.tattoo-drip.test/forgot-password";

test.group("Account mails", (group) => {
	group.each.teardown(() => {
		mailer.restore();
		emitter.restore();
	});

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
			signedOut: "everywhere",
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

	test("a change made while signed in says the device that made it stayed (TAT-95)", async ({
		assert,
	}) => {
		const mail = new PasswordChangedMail({
			to: TO,
			changedAt: "19 Oct 2026 at 14:05 UTC",
			resetUrl: FORGOT,
			signedOut: "elsewhere",
		});
		await mail.buildWithContents();
		const { message } = mail;
		const clause =
			"every device that was signed in was signed out except the one used to change it";

		message.assertSubject("Your Tattoo Drip password was changed");
		message.assertHtmlIncludes(clause);
		message.assertTextIncludes(clause);
		// The actor needed the password and a session, not the mailbox.
		message.assertHtmlIncludes("check who else knows your password");
		message.assertTextIncludes("check who else knows your password");
		message.assertHtmlIncludes("19 Oct 2026 at 14:05 UTC");
		message.assertHtmlIncludes(`href="${FORGOT}"`);
		message.assertTextIncludes(FORGOT);
		for (const body of [
			message.nodeMailerMessage.html,
			message.nodeMailerMessage.text,
		]) {
			assert.notInclude(String(body), "reset-password/");
			assert.notInclude(String(body), "verify-email/");
			assert.notInclude(String(body), "who else can read this mailbox");
		}
	});

	test("a reset's notice keeps the everywhere wording without the exception (TAT-95)", async ({
		assert,
	}) => {
		const notice = new PasswordChangedMail({
			to: TO,
			changedAt: "19 Oct 2026 at 14:05 UTC",
			resetUrl: FORGOT,
			signedOut: "everywhere",
		});
		await notice.buildWithContents();
		const { message } = notice;
		assert.notInclude(
			String(message.nodeMailerMessage.text),
			"except the one used to change it",
		);
		// A reset needed the mailbox: that is what to check.
		message.assertHtmlIncludes("check who else can read this mailbox");
		message.assertTextIncludes("check who else can read this mailbox");
		assert.notInclude(
			String(message.nodeMailerMessage.html),
			"who else knows your password",
		);
	});

	test("a notice queued before this change carries no new fields and still reads as the old wording, never 'undefined' (TAT-95)", async ({
		assert,
	}) => {
		mailer.fake();
		const events = emitter.fake(["mail:sent"]);
		const queued = new PasswordChangedMail({
			to: TO,
			changedAt: "19 Oct 2026 at 14:05 UTC",
			resetUrl: FORGOT,
			signedOut: "everywhere",
		});
		await queued.build();
		const mailMessage = JSON.parse(JSON.stringify(queued.message.toObject()));
		// What the job held before: the view data was changedAt and resetUrl only.
		for (const view of [mailMessage.views.html, mailMessage.views.text]) {
			view.data = {
				changedAt: view.data.changedAt,
				resetUrl: view.data.resetUrl,
			};
		}
		const job = new SendMailJob();
		job.$hydrate(
			{ mailerName: "smtp", mailMessage },
			{
				jobId: "old-notice",
				name: "SendMailJob",
				attempt: 1,
				queue: "default",
				priority: 0,
				acquiredAt: new Date(),
				stalledCount: 0,
			},
		);

		await job.execute();

		const sent = events.find("mail:sent");
		assert.exists(sent);
		for (const body of [sent?.data.message.html, sent?.data.message.text]) {
			const text = String(body);
			assert.include(
				text,
				"19 Oct 2026 at 14:05 UTC, and every device that was signed in was signed out.",
			);
			assert.include(text, "check who else can read this mailbox");
			assert.notInclude(text, "undefined");
			assert.include(text, FORGOT);
		}
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
