import { BaseMail } from "@adonisjs/mail";
import { newInquirySubject } from "#modules/notifications/alerts";

/** What the email shows: plain values, because queued mail is JSON until the worker renders it. */
export type NewInquiryMailData = {
	to: string;
	recipientName: string | null;
	studioName: string;
	/** inquiryIntro's sentence. */
	intro: string;
	/** excerpt() of the idea. */
	excerpt: string;
	/** The inquiry on the dashboard, for owners; null for the asked-for artist, who can't open the inbox. */
	url: string | null;
};

/**
 * Tells a member about a new inquiry (TAT-52): the client's first name, the
 * start of the idea and, for owners, the link to the inquiry. Never the
 * phone, the email address, the budget or the references (spec ruling 5);
 * the subject has no client data, because SendMailJob.failed() logs it.
 */
export default class NewInquiryMail extends BaseMail {
	constructor(private data: NewInquiryMailData) {
		super();
		this.subject = newInquirySubject(data.studioName);
	}

	prepare() {
		const { to, ...view } = this.data;
		this.message
			.to(to)
			.htmlView("notifications::emails/new_inquiry", view)
			.textView("notifications::emails/new_inquiry_text", view);
	}
}
