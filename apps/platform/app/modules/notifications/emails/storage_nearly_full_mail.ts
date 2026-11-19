import { BaseMail } from "@adonisjs/mail";

/** What the email shows: plain values, because queued mail is JSON until the worker renders it. */
export type StorageNearlyFullMailData = {
	to: string;
	recipientName: string | null;
	studioName: string;
	/** Whole percent of the allowance used, rounded down. */
	percent: number;
	/** Nothing is left: uploads are paused now. */
	full: boolean;
	/** The allowance, as people read it: "5 GB". */
	limitText: string;
	/** Settings, Billing on the dashboard, where storage is broken down. */
	url: string;
};

/**
 * Tells a studio's owner its storage is nearly full (the storage meter,
 * step 3, at 95%): how much is used, what happens when it's full, and the
 * Billing page. No client data; the subject names only the studio.
 */
export default class StorageNearlyFullMail extends BaseMail {
	constructor(private data: StorageNearlyFullMailData) {
		super();
		this.subject = `${data.studioName}'s storage is ${data.full ? "full" : "nearly full"}`;
	}

	prepare() {
		const { to, ...view } = this.data;
		this.message
			.to(to)
			.htmlView("notifications::emails/storage_nearly_full", view)
			.textView("notifications::emails/storage_nearly_full_text", view);
	}
}
