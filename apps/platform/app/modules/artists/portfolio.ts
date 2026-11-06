import { STYLE_SLUGS, type StyleSlug } from "#modules/artists/styles";

/**
 * The studio's portfolio (Studio OS): every work photo of the artists a
 * member may see, on one page, filtered and paged by the address. Pure, so
 * the unit tests load it; WorkPhotoService.studioPage runs the query.
 */

/** Photos on one page of the portfolio: four or five full rows on a desktop. */
export const PORTFOLIO_PAGE_SIZE = 40;

/** Whether a photo is on the studio page: its artist is shown or hidden. */
export const PORTFOLIO_STATUSES = ["all", "shown", "hidden"] as const;
export type PortfolioStatus = (typeof PORTFOLIO_STATUSES)[number];

export const PORTFOLIO_SORTS = ["newest", "oldest"] as const;
export type PortfolioSort = (typeof PORTFOLIO_SORTS)[number];

/** The longest search that is read; the rest is cut. */
const MAX_SEARCH = 100;

/** What the address asks the portfolio for, every value checked. */
export type PortfolioQuery = {
	search: string;
	/** An artist id from the address. The controller keeps it only if it is one of the member's. */
	artist: string | null;
	style: StyleSlug | null;
	status: PortfolioStatus;
	healed: boolean;
	sort: PortfolioSort;
	page: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const oneOf = <T extends string>(
	list: readonly T[],
	value: unknown,
	fallback: T,
): T =>
	typeof value === "string" && (list as readonly string[]).includes(value)
		? (value as T)
		: fallback;

/**
 * The query string read with every value checked: an unknown style, status
 * or sort is the default, a page below 1 or not a number is 1, an artist
 * that is not a uuid is none. Never throws, so a hand-edited address shows
 * the portfolio, not an error.
 */
export function parsePortfolioQuery(
	input: Record<string, unknown>,
): PortfolioQuery {
	const search =
		typeof input.q === "string" ? input.q.trim().slice(0, MAX_SEARCH) : "";
	const artist =
		typeof input.artist === "string" && UUID.test(input.artist)
			? input.artist.toLowerCase()
			: null;
	const page = Number(input.page);
	return {
		search,
		artist,
		style: oneOf<StyleSlug | "">(STYLE_SLUGS, input.style, "") || null,
		status: oneOf(PORTFOLIO_STATUSES, input.status, "all"),
		healed: input.healed === "1",
		sort: oneOf(PORTFOLIO_SORTS, input.sort, "newest"),
		page: Number.isInteger(page) && page >= 1 ? page : 1,
	};
}

/**
 * Where a work photo's write goes back to when it was made from the
 * portfolio: `value` if it is this studio's portfolio with a plain query
 * string, else null (the write then goes to the artist's profile, as
 * before). The rule of calendarBack, so the field can never send anyone off
 * the site or to another studio's page.
 */
export function portfolioBack(value: unknown, slug: string): string | null {
	if (typeof value !== "string") return null;
	const page = `/t/${slug}/portfolio`;
	if (value !== page && !value.startsWith(`${page}?`)) return null;
	return /^[\w\-./?=&%]*$/.test(value) ? value : null;
}
