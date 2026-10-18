import { test } from "@japa/runner";
import VerifyEmailMail from "#modules/identity/emails/verify_email_mail";

// Any link survives: a query's `&` is escaped in HTML and kept as typed in text.
const url = "https://app.tattoo-drip.test/verify-email/abc?x=1&y=2";

async function render() {
	const mail = new VerifyEmailMail({ to: "ink@example.com", url });
	await mail.buildWithContents();
	return mail.message;
}

test.group("VerifyEmailMail", () => {
	test("is addressed to the person and leaves the sender to the config", async ({
		assert,
	}) => {
		const message = await render();

		message.assertTo("ink@example.com");
		message.assertSubject("Confirm your email address");
		// config/mail.ts fills in the platform's from address when sending.
		assert.isUndefined(message.nodeMailerMessage.from);
	});

	test("renders the link in the shared layout: escaped in html, as typed in text", async () => {
		const message = await render();

		message.assertHtmlIncludes("<!DOCTYPE html>");
		message.assertHtmlIncludes("Tattoo Drip");
		message.assertHtmlIncludes(
			'href="https://app.tattoo-drip.test/verify-email/abc?x=1&amp;y=2"',
		);
		message.assertTextIncludes(url);
		message.assertTextIncludes("The link works for 24 hours");
	});

	test("says hello without a name and carries nothing but the link", async ({
		assert,
	}) => {
		const message = await render();
		message.assertHtmlIncludes("Hello,");
		message.assertTextIncludes("Hello,");

		const queued = new VerifyEmailMail({ to: "ink@example.com", url });
		await queued.build();
		assert.deepEqual(queued.message.toObject().views.html?.data, { url });
	});
});
