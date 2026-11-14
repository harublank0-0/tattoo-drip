import {
	POST_FILTERS,
	type PostFilter,
	REVIEW_FILTERS,
	type ReviewFilter,
} from "#modules/reviews/rules";

/** What the Reviews page's address holds (Reviews and Fresh ink, slice 2). */
export type ReviewsQuery = {
	/** Fresh ink posts or reviews. */
	view: "posts" | "reviews";
	posts: PostFilter;
	reviews: ReviewFilter;
	/** An artist's id (owners); ignored unless it is one of the studio's. */
	artist: string | null;
	page: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function oneOf<T extends string>(
	list: readonly T[],
	value: unknown,
	fallback: T,
): T {
	return typeof value === "string" &&
		(list as readonly string[]).includes(value)
		? (value as T)
		: fallback;
}

/** The Reviews page's address read leniently: anything unknown is its default. */
export function parseReviewsQuery(
	input: Record<string, unknown>,
): ReviewsQuery {
	const page = Number(input.page);
	return {
		view: input.view === "reviews" ? "reviews" : "posts",
		posts: oneOf(POST_FILTERS, input.status, "waiting"),
		reviews: oneOf(REVIEW_FILTERS, input.filter, "all"),
		artist:
			typeof input.artist === "string" && UUID.test(input.artist)
				? input.artist.toLowerCase()
				: null,
		page: Number.isInteger(page) && page >= 1 ? page : 1,
	};
}

/**
 * Where a Reviews page write goes back to: `value` if it is this studio's
 * Reviews page with a plain query string, else the page itself (the rule of
 * portfolioBack, so the field never sends anyone off the site or to another
 * studio's page).
 */
export function reviewsBack(value: unknown, slug: string): string {
	const page = `/t/${slug}/reviews`;
	if (typeof value !== "string") return page;
	if (value !== page && !value.startsWith(`${page}?`)) return page;
	return /^[\w\-./?=&%]*$/.test(value) ? value : page;
}
