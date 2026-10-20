import { BaseMail } from "@adonisjs/mail";
import { depositProofSubject } from "#modules/notifications/alerts";

/** What the email shows: plain values, because queued mail is JSON until the worker renders it. */
export type DepositProofMailData = {
	to: string;
	recipientName: string | null;
	studioName: string;
	/** proofIntro's sentence. */
	intro: string;
	/** An owner checks the screenshot; anyone else (the project's artist) is told an owner will. */
	forOwner: boolean;
	/** The project's Payments card on the dashboard (APP_URL + paymentsCardPath). */
	url: string;
};

/**
 * Tells a member that a client sent a deposit screenshot (TAT-88): the
 * client's first name and the link to the project's Payments card. Never
 * the amount, the method, the reference code, the deposit link, the phone
 * or the screenshot (spec ruling 7); the subject has no client data,
 * because SendMailJob.failed() logs it.
 */
export default class DepositProofMail extends BaseMail {
	constructor(private data: DepositProofMailData) {
		super();
		this.subject = depositProofSubject(data.studioName);
	}

	prepare() {
		const { to, ...view } = this.data;
		this.message
			.to(to)
			.htmlView("notifications::emails/deposit_proof", view)
			.textView("notifications::emails/deposit_proof_text", view);
	}
}
