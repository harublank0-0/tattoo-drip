import { BaseMail } from "@adonisjs/mail";
import { onlinePaymentSubject } from "#modules/notifications/alerts";

/** What the email shows: plain values, because queued mail is JSON until the worker renders it. */
export type OnlinePaymentMailData = {
	to: string;
	recipientName: string | null;
	studioName: string;
	/** onlinePaymentIntro's sentence. */
	intro: string;
	/** Held for review (no ledger row) rather than recorded as a deposit. */
	held: boolean;
	/** The project's Payments card, or (held) the Transactions page. */
	url: string;
};

/**
 * Tells a member that PayBridgeNP reported a client's online payment:
 * recorded as a deposit, or held for review because it didn't match its
 * checkout. The client's first name and a link; never the amount, the
 * method, PayBridgeNP's reference or the review reason. The subject has no
 * client data, because SendMailJob.failed() logs it.
 */
export default class OnlinePaymentMail extends BaseMail {
	constructor(private data: OnlinePaymentMailData) {
		super();
		this.subject = onlinePaymentSubject(data.studioName, data.held);
	}

	prepare() {
		const { to, ...view } = this.data;
		this.message
			.to(to)
			.htmlView("notifications::emails/online_payment", view)
			.textView("notifications::emails/online_payment_text", view);
	}
}
