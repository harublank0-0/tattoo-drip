import { BaseMail } from "@adonisjs/mail";
import { freshInkSubject } from "#modules/notifications/alerts";

/** What the email shows: plain values, because queued mail is JSON until the worker renders it. */
export type FreshInkMailData = {
	to: string;
	recipientName: string | null;
	studioName: string;
	/** freshInkIntro's sentence. */
	intro: string;
	/** A client's change of an approved post: it waits for approval again. */
	edited: boolean;
	/** The Reviews page on the dashboard (APP_URL + reviewsPath). */
	url: string;
};

/**
 * Tells a member that a Fresh ink post waits for the studio's approval
 * (Reviews and Fresh ink, slice 2): the name the client chose to show and
 * the link to the Reviews page. Never the client's full name, phone or
 * email, the caption, the photos or a signed URL; the subject has no client
 * data, because SendMailJob.failed() logs it.
 */
export default class FreshInkMail extends BaseMail {
	constructor(private data: FreshInkMailData) {
		super();
		this.subject = freshInkSubject(data.studioName);
	}

	prepare() {
		const { to, ...view } = this.data;
		this.message
			.to(to)
			.htmlView("notifications::emails/fresh_ink", view)
			.textView("notifications::emails/fresh_ink_text", view);
	}
}
