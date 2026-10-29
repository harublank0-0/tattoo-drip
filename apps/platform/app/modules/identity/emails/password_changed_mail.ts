import { BaseMail } from "@adonisjs/mail";
import type { DateTime } from "luxon";

/**
 * What the email shows: plain values, because queued mail is JSON until the
 * worker renders it. The worker renders with the templates it runs, so a job
 * queued before a template learned a new view field carries none of it: the
 * templates default each one to the wording of the first version.
 */
export type PasswordChangedMailData = {
	to: string;
	/** changedAtText() of the change. */
	changedAt: string;
	/** APP_URL/forgot-password: a page to ask for a new link, never a token. */
	resetUrl: string;
	/**
	 * A reset signs every device out; a change made while signed in keeps the
	 * device that made it (TAT-95). Required, so each call site chooses.
	 */
	signedOut: "everywhere" | "elsewhere";
};

/**
 * What the notice asks the person to check if it wasn't them (TAT-95): after a
 * reset the person had the mailbox, after a change made while signed in they
 * had the password and a session, never the mailbox.
 */
export function checkWhoText(
	signedOut: PasswordChangedMailData["signedOut"],
): string {
	return signedOut === "everywhere"
		? "who else can read this mailbox"
		: "who else knows your password";
}

/** The end of the notice's first sentence. */
export function signedOutText(
	signedOut: PasswordChangedMailData["signedOut"],
): string {
	return signedOut === "everywhere"
		? "every device that was signed in was signed out"
		: "every device that was signed in was signed out except the one used to change it";
}

/** When the password changed, for the email: "19 Oct 2026 at 14:05 UTC". */
export function changedAtText(at: DateTime): string {
	return at
		.setZone("utc")
		.setLocale("en-US")
		.toFormat("d LLL yyyy 'at' HH:mm 'UTC'");
}

/**
 * Tells the account's mailbox that its password was changed and which
 * sessions were signed out (TAT-18: a reset signs out every one; TAT-95: a
 * change from the account page keeps the device that made it), with a way to
 * take the account back.
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
			signedOut: signedOutText(this.data.signedOut),
			checkWho: checkWhoText(this.data.signedOut),
		};
		this.message
			.to(this.data.to)
			.htmlView("identity::emails/password_changed", view)
			.textView("identity::emails/password_changed_text", view);
	}
}
