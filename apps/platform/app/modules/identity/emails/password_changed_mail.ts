import { BaseMail } from "@adonisjs/mail";
import type { DateTime } from "luxon";

/** What the email shows: plain values, because queued mail is JSON until the worker renders it. */
export type PasswordChangedMailData = {
	to: string;
	/** changedAtText() of the change. */
	changedAt: string;
	/** APP_URL/forgot-password: a page to ask for a new link, never a token. */
	resetUrl: string;
};

/** When the password changed, for the email: "19 Oct 2026 at 14:05 UTC". */
export function changedAtText(at: DateTime): string {
	return at
		.setZone("utc")
		.setLocale("en-US")
		.toFormat("d LLL yyyy 'at' HH:mm 'UTC'");
}

/**
 * Tells the account's mailbox that its password was changed and every
 * session signed out (TAT-18), with a way to take the account back.
 */
export default class PasswordChangedMail extends BaseMail {
	subject = "Your Tattoo Drip password was changed";

	constructor(private data: PasswordChangedMailData) {
		super();
	}

	prepare() {
		const view = {
			changedAt: this.data.changedAt,
			resetUrl: this.data.resetUrl,
		};
		this.message
			.to(this.data.to)
			.htmlView("identity::emails/password_changed", view)
			.textView("identity::emails/password_changed_text", view);
	}
}
