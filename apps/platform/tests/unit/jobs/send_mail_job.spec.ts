import emitter from "@adonisjs/core/services/emitter";
import mail from "@adonisjs/mail/services/main";
import { test } from "@japa/runner";
import SendMailJob from "#jobs/send_mail_job";
import VerifyEmailMail from "#modules/identity/emails/verify_email_mail";

const verifyUrl = "https://app.tattoo-drip.test/verify-email/abc";

test.group("SendMailJob", (group) => {
	group.each.teardown(() => {
		mail.restore();
		emitter.restore();
	});

	test("sends the queued email to its recipient, with templates rendered", async ({
		assert,
	}) => {
		mail.fake();

		const events = emitter.fake(["mail:sent"]);

		const email = new VerifyEmailMail({
			to: "ink@example.com",
			url: verifyUrl,
		});

		await email.build();

		const mailMessage = JSON.parse(JSON.stringify(email.message.toObject()));

		const job = new SendMailJob();

		job.$hydrate(
			{ mailerName: "smtp", mailMessage },
			{
				jobId: "test-job",
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
		assert.include(JSON.stringify(sent?.data.message.to), "ink@example.com");
		assert.include(String(sent?.data.message.html), "Hello,");
	});
});
