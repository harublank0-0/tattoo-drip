import { BaseMail } from "@adonisjs/mail";

/** What the email shows: plain values, because queued mail is JSON until the worker renders it. */
export type BillingReviewMailData = {
	to: string;
	/**
	 * `reversed`: a paid invoice turned void, uncollectible or written off,
	 * and the period it granted ended. `unresolved`: a paid invoice granted
	 * nothing, because its stored period doesn't fit its dates and its plan
	 * is unknown (none named, or none TattooDrip has in this mode).
	 */
	kind: "reversed" | "unresolved";
	/** The studio's slug: never a name, which is free text (see ConnectionToVerifyMail). */
	studioSlug: string;
	/** "sandbox" or "live". */
	mode: string;
	/** For `reversed`: what PayBridgeNP did, in words ("voided"). */
	reasonText: string | null;
	/** The invoice's status code for `reversed` ("void"), for the record. */
	reason: string | null;
	/** The admin Billing page (APP_URL + /admin/billing). */
	url: string;
};

/**
 * Tells a TattooDrip platform admin (PLATFORM_ADMIN_EMAILS) that a studio's
 * paid access changed without anyone at TattooDrip deciding it, so they can
 * check PayBridgeNP (docs/payments-paybridgenp.md). Only the studio's slug,
 * the mode and the invoice's status: no names, amounts or invoice numbers.
 * The subject names no one, because SendMailJob.failed() logs it.
 */
export default class BillingReviewMail extends BaseMail {
	subject: string;

	constructor(private data: BillingReviewMailData) {
		super();
		this.subject =
			data.kind === "reversed"
				? "Studio paid access ended"
				: "Paid studio invoice not granted";
	}

	prepare() {
		const { to, ...view } = this.data;
		this.message
			.to(to)
			.htmlView("notifications::emails/billing_review", view)
			.textView("notifications::emails/billing_review_text", view);
	}
}
