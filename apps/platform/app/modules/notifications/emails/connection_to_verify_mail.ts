import { BaseMail } from "@adonisjs/mail";

/** What the email shows: plain values, because queued mail is JSON until the worker renders it. */
export type ConnectionToVerifyMailData = {
	to: string;
	/** The studio's slug: never a name, which is free text (see below). */
	studioSlug: string;
	/** "sandbox" or "live". */
	mode: string;
	/** The admin Payments page (APP_URL + /admin/payments). */
	url: string;
};

/**
 * Tells a TattooDrip platform admin (PLATFORM_ADMIN_EMAILS) that a studio
 * connected its PayBridgeNP project and waits for a check before taking
 * online deposits. Only the studio's slug and the mode: the studio's name
 * and the PayBridgeNP merchant and project names are free text a mail
 * client could turn into a link ("verify at evil.example"), and the admin
 * page shows them. Never the key, its hint or the webhook address. The
 * subject names no one, because SendMailJob.failed() logs it.
 */
export default class ConnectionToVerifyMail extends BaseMail {
	subject = "Studio payment connection to verify";

	constructor(private data: ConnectionToVerifyMailData) {
		super();
	}

	prepare() {
		const { to, ...view } = this.data;
		this.message
			.to(to)
			.htmlView("notifications::emails/connection_to_verify", view)
			.textView("notifications::emails/connection_to_verify_text", view);
	}
}
