import { BaseMail } from "@adonisjs/mail";
import type User from "#models/user";

/**
 * Asks a new user to confirm their email address. The caller makes and
 * signs `verifyUrl`; this mail only renders it.
 */
export default class VerifyEmailMail extends BaseMail {
	subject = "Verify your email";

	constructor(
		private user: User,
		private verifyUrl: string,
	) {
		super();
	}

	prepare() {
		const data = { user: this.user, verifyUrl: this.verifyUrl };

		this.message
			.to(this.user.email)
			.htmlView("identity::emails/verify_email", data)
			.textView("identity::emails/verify_email_text", data);
	}
}
