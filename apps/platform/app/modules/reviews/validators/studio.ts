import vine, { SimpleMessagesProvider } from "@vinejs/vine";
import {
	MAX_REPLY_LENGTH,
	MAX_REPORT_NOTE_LENGTH,
	REPORT_REASONS,
} from "#modules/reviews/rules";
import {
	characters,
	plainText,
	REVIEW_MESSAGES,
} from "#modules/reviews/validators/review_page";

/** The dashboard's words for the Reviews page's forms (Reviews and Fresh ink, slice 2). */
export const STUDIO_REVIEW_MESSAGES = {
	replyEmpty: "Write the reply, or delete it.",
	replyLong: `Keep the reply to ${MAX_REPLY_LENGTH.toLocaleString("en")} characters.`,
	reason: "Choose why you report it.",
	noteLong: `Keep the note to ${MAX_REPORT_NOTE_LENGTH} characters.`,
} as const;

/**
 * The studio's one public reply to a review (ruling 6): plain text, 1 to
 * 1,000 characters (code points) after trimming. Its only field: no route
 * takes a rating, a review's text or a name from the studio.
 */
export const replyValidator = vine.create({
	reply: vine
		.string()
		.trim()
		.use(plainText())
		.use(
			characters({
				min: 1,
				max: MAX_REPLY_LENGTH,
				short: STUDIO_REVIEW_MESSAGES.replyEmpty,
				long: STUDIO_REVIEW_MESSAGES.replyLong,
			}),
		),
});
replyValidator.messagesProvider = new SimpleMessagesProvider({
	"reply.required": STUDIO_REVIEW_MESSAGES.replyEmpty,
	"reply.string": STUDIO_REVIEW_MESSAGES.replyEmpty,
});

/** A report to TattooDrip (ruling 6): one of the reasons, and an optional note of up to 500 characters. */
export const reportValidator = vine.create({
	reason: vine.enum(REPORT_REASONS),
	note: vine
		.string()
		.trim()
		.use(plainText())
		.use(
			characters({
				min: 0,
				max: MAX_REPORT_NOTE_LENGTH,
				short: STUDIO_REVIEW_MESSAGES.noteLong,
				long: STUDIO_REVIEW_MESSAGES.noteLong,
			}),
		)
		.optional(),
});
reportValidator.messagesProvider = new SimpleMessagesProvider({
	"reason.required": STUDIO_REVIEW_MESSAGES.reason,
	"reason.enum": STUDIO_REVIEW_MESSAGES.reason,
	"note.string": REVIEW_MESSAGES.text,
});
