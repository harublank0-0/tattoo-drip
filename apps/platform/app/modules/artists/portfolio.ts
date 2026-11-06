import { STYLE_SLUGS, type StyleSlug } from "#modules/artists/styles";

/**
 * The studio's portfolio (Studio OS): every work photo of the artists a
 * member may see, on one page, filtered and paged by the address. Pure, so
 * the unit tests load it; WorkPhotoService.studioPage runs the query.
 */

/** Photos on one page of the portfolio: four or five full rows on a desktop. */
export const PORTFOLIO_PAGE_SIZE = 40;

/**
 * Where a photo stands on the studio page: published and its artist shown
 * (on the page), unpublished by the studio, or published while its artist
 * is hidden (not on the page until the artist is shown).
 */
export const PORTFOLIO_STATUSES = [
	"all",
	"published",
	"unpublished",
	"artist_hidden",
] as const;
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

/** What the portfolio can do to several photos at once. */
export const BULK_ACTIONS = [
	"publish",
	"unpublish",
	"reassign",
	"delete",
] as const;
export type BulkAction = (typeof BULK_ACTIONS)[number];

/** Why one photo of a bulk change was not changed. */
export type BulkFailure = "gone" | "full" | "files" | "same";

const BULK_DONE: Record<BulkAction, string> = {
	publish: "published",
	unpublish: "unpublished",
	reassign: "moved",
	delete: "deleted",
};

const photos = (n: number) => `${n} ${n === 1 ? "photo" : "photos"}`;

/**
 * What a bulk change says when it ends: how many were changed and, for
 * those that weren't, how many and why, so no failure goes unsaid. `artist`
 * is the artist a move went to. `ok` is false when any photo failed: the
 * message is then an error flash.
 */
export function bulkSummary(
	action: BulkAction,
	done: number,
	failures: readonly BulkFailure[],
	artist?: string,
): { ok: boolean; message: string } {
	const verb =
		action === "reassign" && artist ? `moved to ${artist}` : BULK_DONE[action];
	if (failures.length === 0) {
		return { ok: true, message: `${upperFirst(photos(done))} ${verb}.` };
	}
	const count = (kind: BulkFailure) =>
		failures.filter((failure) => failure === kind).length;
	const reasons = [
		count("gone") > 0
			? `${photos(count("gone"))} removed or changed meanwhile`
			: "",
		count("full") > 0
			? `${photos(count("full"))} over ${artist ?? "the artist"}'s limit of 100`
			: "",
		count("files") > 0
			? `${photos(count("files"))} whose files couldn't be removed (try again)`
			: "",
		count("same") > 0
			? `${photos(count("same"))} already with ${artist ?? "that artist"}`
			: "",
	].filter(Boolean);
	const head =
		done > 0
			? `${upperFirst(photos(done))} ${verb}.`
			: `No photos were ${BULK_DONE[action]}.`;
	return {
		ok: false,
		message: `${head} Not changed: ${reasons.join("; ")}.`,
	};
}

function upperFirst(text: string): string {
	return text.charAt(0).toUpperCase() + text.slice(1);
}
