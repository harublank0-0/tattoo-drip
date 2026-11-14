import vine, { SimpleMessagesProvider } from "@vinejs/vine";
import {
	CURSOR_MESSAGE,
	MAX_WORK_PAGE,
} from "#modules/storefront/validators/work";

/**
 * The query of listReviews and listFreshInk (Reviews and Fresh ink, slice
 * 3), both optional: the gallery's cursor shape and page size (listWork). A
 * cursor that has the alphabet but is not one decodes to null in the
 * controller, which says the same thing. No filter: the studio's page shows
 * them newest first, all of them.
 */
export const listPublicReviewsValidator = vine.create({
	cursor: vine
		.string()
		.maxLength(200)
		.regex(/^[A-Za-z0-9_-]+$/)
		.optional(),
	limit: vine.number().withoutDecimals().min(1).max(MAX_WORK_PAGE).optional(),
});

const LIMIT_MESSAGE = `Use a whole number from 1 to ${MAX_WORK_PAGE}.`;
listPublicReviewsValidator.messagesProvider = new SimpleMessagesProvider({
	"cursor.regex": CURSOR_MESSAGE,
	"cursor.maxLength": CURSOR_MESSAGE,
	"cursor.string": CURSOR_MESSAGE,
	"limit.number": LIMIT_MESSAGE,
	"limit.withoutDecimals": LIMIT_MESSAGE,
	"limit.min": LIMIT_MESSAGE,
	"limit.max": LIMIT_MESSAGE,
});
