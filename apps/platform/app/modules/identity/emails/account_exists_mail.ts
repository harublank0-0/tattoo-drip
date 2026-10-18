import { BaseMail } from "@adonisjs/mail";

/** What the email shows: plain values, because queued mail is JSON until the worker renders it. */
export type AccountExistsMailData = {
	to: string;
	/** APP_URL/login. */
	signInUrl: string;
	/** A reset link issued with this email: APP_URL/reset-password/<token>. */
	resetUrl: string;
};

/**
 * Answers a signup for an address that already has an account (TAT-18).
 * The signup page says "Check your email" either way, so the page never
 * tells whether an address is registered; this email tells its owner, with
 * a sign-in link and a reset link. No name: see VerifyEmailMail.
 */
export default class AccountExistsMail extends BaseMail {
	subject = "You already have a Tattoo Drip account";

	constructor(private data: AccountExistsMailData) {
		super();
	}

	prepare() {
		const view = {
			signInUrl: this.data.signInUrl,
			resetUrl: this.data.resetUrl,
		};
		this.message
			.to(this.data.to)
			.htmlView("identity::emails/account_exists", view)
			.textView("identity::emails/account_exists_text", view);
	}
}
