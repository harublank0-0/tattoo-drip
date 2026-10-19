import mail from "@adonisjs/mail/services/main";
import queue from "@adonisjs/queue/services/main";
import { test } from "@japa/runner";
import SendMailJob, { type SendMailPayload } from "#jobs/send_mail_job";
import VerifyEmailMail from "#modules/identity/emails/verify_email_mail";

const verifyUrl = "https://app.tattoo-drip.test/verify-email/abc";

test.group("MailMessenger", (group) => {
	group.each.teardown(() => {
		queue.restore();
	});

	test("sends the email to the queue", async () => {
		const fake = queue.fake();

		const email = new VerifyEmailMail({
			to: "ink@example.com",
			url: verifyUrl,
		});

		await mail.sendLater(email);

		fake.assertPushed(SendMailJob, {
			payload: (payload: SendMailPayload) =>
				payload.mailMessage.message.to?.[0] === "ink@example.com",
		});
	});
});
