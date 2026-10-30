import vine, { SimpleMessagesProvider } from "@vinejs/vine";
import { ARTIST_SLUG } from "#modules/artists/validators/artist";
import {
	CURSOR_MESSAGE,
	MAX_WORK_PAGE,
} from "#modules/storefront/validators/work";

/**
 * The query of listFlash (TAT-129), all optional. Shapes only, as the
 * contract writes them: whether the artist exists is no error (a filter that
 * matches nothing is an empty page), and a cursor that has the alphabet but
 * is not one decodes to null in the controller, which says the same thing.
 * The page's size and the cursor are the gallery's (listWork).
 */
export const listFlashValidator = vine.create({
	artist: vine.string().regex(ARTIST_SLUG).optional(),
	cursor: vine
		.string()
		.maxLength(200)
		.regex(/^[A-Za-z0-9_-]+$/)
		.optional(),
	limit: vine.number().withoutDecimals().min(1).max(MAX_WORK_PAGE).optional(),
});

const LIMIT_MESSAGE = `Use a whole number from 1 to ${MAX_WORK_PAGE}.`;
listFlashValidator.messagesProvider = new SimpleMessagesProvider({
	"artist.regex": "Use an artist's slug.",
	"artist.string": "Use an artist's slug.",
	"cursor.regex": CURSOR_MESSAGE,
	"cursor.maxLength": CURSOR_MESSAGE,
	"cursor.string": CURSOR_MESSAGE,
	"limit.number": LIMIT_MESSAGE,
	"limit.withoutDecimals": LIMIT_MESSAGE,
	"limit.min": LIMIT_MESSAGE,
	"limit.max": LIMIT_MESSAGE,
});
