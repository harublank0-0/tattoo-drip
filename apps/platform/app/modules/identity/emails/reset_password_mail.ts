import { BaseMail } from "@adonisjs/mail";

/** What the email shows: plain values, because queued mail is JSON until the worker renders it. */
export type ResetPasswordMailData = {
	to: string;
	/** The reset link: APP_URL/reset-password/<token>. */
	url: string;
};

/**
 * A password reset link (TAT-18), sent only to an address an account uses.
 * No name, and the subject holds no link.
 */
export default class ResetPasswordMail extends BaseMail {
	subject = "Choose a new password";

	constructor(private data: ResetPasswordMailData) {
		super();
	}

	prepare() {
		const view = { url: this.data.url };
		this.message
			.to(this.data.to)
			.htmlView("identity::emails/reset_password", view)
			.textView("identity::emails/reset_password_text", view);
	}
}
