import vine, { SimpleMessagesProvider } from "@vinejs/vine";
import { STYLE_SLUG_SHAPE } from "#modules/artists/styles";
import { ARTIST_SLUG } from "#modules/artists/validators/artist";

/** A page of the gallery unless `limit` says otherwise (listWork in openapi.yaml). */
export const WORK_PAGE_SIZE = 24;
/** The most photos a page can hold. */
export const MAX_WORK_PAGE = 48;

/** What every refused cursor says: the client got it from a page and should send it back unchanged. */
export const CURSOR_MESSAGE =
	"Pass a nextCursor exactly as the previous page sent it.";

/**
 * The query of listWork (TAT-126), all optional. Shapes only, as the
 * contract writes them: whether the artist or the style exists is no error
 * (a filter that matches nothing is an empty page), and a cursor that has
 * the alphabet but is not one decodes to null in the controller, which says
 * the same thing. `healed=false` is the same as leaving `healed` out. The
 * style's shape is checked here because the database would refuse a NUL
 * byte with an error of its own.
 */
export const listWorkValidator = vine.create({
	artist: vine.string().regex(ARTIST_SLUG).optional(),
	style: vine.string().maxLength(40).regex(STYLE_SLUG_SHAPE).optional(),
	healed: vine.boolean().optional(),
	cursor: vine
		.string()
		.maxLength(200)
		.regex(/^[A-Za-z0-9_-]+$/)
		.optional(),
	limit: vine.number().withoutDecimals().min(1).max(MAX_WORK_PAGE).optional(),
});

const LIMIT_MESSAGE = `Use a whole number from 1 to ${MAX_WORK_PAGE}.`;
const STYLE_MESSAGE = "Use a style's slug from the list of styles.";
listWorkValidator.messagesProvider = new SimpleMessagesProvider({
	"artist.regex": "Use an artist's slug.",
	"artist.string": "Use an artist's slug.",
	"style.regex": STYLE_MESSAGE,
	"style.maxLength": STYLE_MESSAGE,
	"style.string": STYLE_MESSAGE,
	"healed.boolean": "Use true or false.",
	"cursor.regex": CURSOR_MESSAGE,
	"cursor.maxLength": CURSOR_MESSAGE,
	"cursor.string": CURSOR_MESSAGE,
	"limit.number": LIMIT_MESSAGE,
	"limit.withoutDecimals": LIMIT_MESSAGE,
	"limit.min": LIMIT_MESSAGE,
	"limit.max": LIMIT_MESSAGE,
});
