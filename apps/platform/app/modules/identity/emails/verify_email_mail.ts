import { BaseMail } from "@adonisjs/mail";

/** What the email shows: plain values, because queued mail is JSON until the worker renders it. */
export type VerifyEmailMailData = {
	to: string;
	/** The confirmation link: APP_URL/verify-email/<token>. */
	url: string;
};

/**
 * Asks a person to confirm the address of their account (TAT-18). It prints
 * nothing the signup form took, not even the name: the form is open to
 * anyone, and the email goes to whatever address they typed. The subject
 * holds no link, since SendMailJob.failed() logs it.
 */
export default class VerifyEmailMail extends BaseMail {
	subject = "Confirm your email address";

	constructor(private data: VerifyEmailMailData) {
		super();
	}

	prepare() {
		const view = { url: this.data.url };
		this.message
			.to(this.data.to)
			.htmlView("identity::emails/verify_email", view)
			.textView("identity::emails/verify_email_text", view);
	}
}
