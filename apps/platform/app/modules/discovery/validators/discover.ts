import vine, { SimpleMessagesProvider } from "@vinejs/vine";
import { STYLE_SLUGS } from "#modules/artists/styles";
import { MAX_CURSOR_LENGTH } from "#modules/discovery/cursor";

/**
 * The queries of Discover's lists (Discover D03, docs/discover/api.md), all
 * optional, shapes only: a filter that matches nothing is an empty page, a
 * malformed one the 422 validation_failed. Unknown parameters are ignored.
 * Text is never put into SQL: every value becomes a bound parameter.
 */
export const DISCOVER_PAGE_SIZE = 24;
export const MAX_DISCOVER_PAGE = 48;
export const MIN_QUERY_LENGTH = 2;
export const MAX_QUERY_LENGTH = 80;

/** A studio's slug as stored (the tenant slug registry's CHECK). */
const STUDIO_SLUG = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
/** A place's slug (places_slug_format). */
const PLACE_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
/** Any letter case, as `format: uuid` allows; compared lower-cased. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// biome-ignore lint/suspicious/noControlCharactersInRegex: refusing them is the point.
const NO_CONTROL = /^[^\u0000-\u001f\u007f]*$/;

const q = () =>
	vine
		.string()
		.trim()
		.minLength(MIN_QUERY_LENGTH)
		.maxLength(MAX_QUERY_LENGTH)
		.regex(NO_CONTROL)
		.optional();
const country = () =>
	vine
		.string()
		.regex(/^[A-Za-z]{2}$/)
		.transform((value) => value.toUpperCase())
		.optional();
const style = () => vine.enum(STYLE_SLUGS).optional();
const cursor = () =>
	vine
		.string()
		.maxLength(MAX_CURSOR_LENGTH)
		.regex(/^[A-Za-z0-9_-]+$/)
		.optional();
const limit = () =>
	vine.number().withoutDecimals().min(1).max(MAX_DISCOVER_PAGE).optional();

export const listDiscoverStudiosValidator = vine.create({
	q: q(),
	country: country(),
	city: vine.string().maxLength(63).regex(PLACE_SLUG).optional(),
	style: style(),
	sort: vine.enum(["name", "-name", "newest"] as const).optional(),
	cursor: cursor(),
	limit: limit(),
});

export const listDiscoverArtistsValidator = vine.create({
	q: q(),
	country: country(),
	city: vine.string().maxLength(63).regex(PLACE_SLUG).optional(),
	style: style(),
	studio: vine.string().regex(STUDIO_SLUG).optional(),
	independent: vine.boolean().optional(),
	sort: vine.enum(["name", "-name", "newest"] as const).optional(),
	cursor: cursor(),
	limit: limit(),
});

export const listDiscoverTattoosValidator = vine.create({
	// D09: the gallery's search (alt text, artist, studio and style names).
	q: q(),
	country: country(),
	city: vine.string().maxLength(63).regex(PLACE_SLUG).optional(),
	style: style(),
	studio: vine.string().regex(STUDIO_SLUG).optional(),
	artist: vine
		.string()
		.regex(UUID)
		.transform((value) => value.toLowerCase())
		.optional(),
	healed: vine.boolean().optional(),
	cursor: cursor(),
	limit: limit(),
});

export const CURSOR_MESSAGE =
	"Pass a nextCursor exactly as the previous page sent it, with the same sort.";
export const CITY_MESSAGE = "Name the country of the city (country=NP).";
const LIMIT_MESSAGE = `Use a whole number from 1 to ${MAX_DISCOVER_PAGE}.`;
const QUERY_MESSAGE = `Search with ${MIN_QUERY_LENGTH} to ${MAX_QUERY_LENGTH} characters.`;

const messages = new SimpleMessagesProvider({
	"q.string": QUERY_MESSAGE,
	"q.minLength": QUERY_MESSAGE,
	"q.maxLength": QUERY_MESSAGE,
	"q.regex": QUERY_MESSAGE,
	"country.string": "Use a two-letter country code (NP).",
	"country.regex": "Use a two-letter country code (NP).",
	"city.string": "Use a city's slug from the list of locations.",
	"city.regex": "Use a city's slug from the list of locations.",
	"city.maxLength": "Use a city's slug from the list of locations.",
	"style.enum": "Use a style's slug from the list of styles.",
	"sort.enum": "Sort by name, -name or newest.",
	"studio.string": "Use a studio's slug.",
	"studio.regex": "Use a studio's slug.",
	"artist.string": "Use an artist's id.",
	"artist.regex": "Use an artist's id.",
	"independent.boolean": "Use true or false.",
	"healed.boolean": "Use true or false.",
	"cursor.string": CURSOR_MESSAGE,
	"cursor.regex": CURSOR_MESSAGE,
	"cursor.maxLength": CURSOR_MESSAGE,
	"limit.number": LIMIT_MESSAGE,
	"limit.withoutDecimals": LIMIT_MESSAGE,
	"limit.min": LIMIT_MESSAGE,
	"limit.max": LIMIT_MESSAGE,
});
listDiscoverStudiosValidator.messagesProvider = messages;
listDiscoverArtistsValidator.messagesProvider = messages;
listDiscoverTattoosValidator.messagesProvider = messages;
