import type { ListReviewsQuery } from "@tattoo-drip/sdk";
import { fill } from "../intake/template.ts";
import { studioCopy } from "./copy.ts";
import { cleanLine, cleanText } from "./text.ts";
import { ARTIST_SLUG } from "./view-model.ts";

/**
 * Client reviews on the studio's own page (Reviews and Fresh ink, slice 3):
 * the API's pages of reviews (`GET /reviews`, listReviews) as the reviews
 * the sections and `/reviews` show, and the address's page read back
 * strictly. Pure. Everything the API sends is checked here, so an older,
 * newer or hostile answer is at worst fewer reviews. Text stays text: a body
 * keeps its line breaks and is rendered with `white-space: pre-line`, never
 * as markup. The average shows only from 3 reviews (ruling 10), whatever
 * the API sends, and there is never review structured data here: Google
 * does not take a business's own reviews of itself.
 */

/** The home page's Reviews section shows the newest this many. */
export const HOME_REVIEWS_COUNT = 6;
/** `/reviews` loads this many a page. */
export const REVIEWS_PAGE_SIZE = 24;
/** The most reviews read from one answer (the contract's `limit` maximum). */
const MAX_REVIEWS_PAGE = 48;
/** The average and count show only from this many reviews (ruling 10). */
export const MIN_RATED_REVIEWS = 3;
/** A review's text, a reply's and a shown name at most, in characters (the contract's). */
const MAX_BODY = 2000;
const MAX_REPLY = 1000;
const MAX_NAME = 40;

/** A cursor as the API writes it: base64url, at most 200 characters. */
const CURSOR = /^[A-Za-z0-9_-]{1,200}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A day the API sent ("2026-10-01"), as the page says it ("October 2026") and as `<time dateTime>` takes it. */
export interface DayView {
	readonly text: string;
	readonly dateTime: string;
}

/** One review as the page shows it. */
export interface ReviewView {
	readonly id: string;
	/** Whole stars, 1 to 5. */
	readonly rating: number;
	/** "4 out of 5": what the stars say in words. */
	readonly ratingText: string;
	/** The client's words, plain text with its line breaks. */
	readonly body: string;
	/** The name the client chose to show ("Sita R."). */
	readonly name: string;
	readonly date: DayView | null;
	/** The artist who made the tattoo and their page, while the studio shows them. */
	readonly artist: { readonly name: string; readonly href: string } | null;
	/** The studio's reply, unless it has none or TattooDrip took it down. */
	readonly reply: {
		readonly body: string;
		readonly date: DayView | null;
	} | null;
}

/** The studio's average from 3 reviews: "4.7 from 12 reviews". */
export interface RatingView {
	readonly average: number;
	/** "4.7": one decimal. */
	readonly averageText: string;
	readonly count: number;
	/** "4.7 from 12 reviews": what the page shows. */
	readonly text: string;
	/** "from 12 reviews": the line after the average, which a screen reader hears as "4.7 out of 5 from 12 reviews". */
	readonly fromText: string;
	/** The whole stars drawn beside it: the average rounded down (4.7 is four), so they never claim more. */
	readonly stars: number;
}

export interface ReviewsView {
	readonly reviews: readonly ReviewView[];
	/** The cursor of the next page, or null on the last. */
	readonly nextCursor: string | null;
	/** Null below 3 reviews: then the reviews show without an average. */
	readonly rating: RatingView | null;
}

/** What an older API, a failed read or a garbled answer comes to. */
export const EMPTY_REVIEWS: ReviewsView = Object.freeze({
	reviews: [],
	nextCursor: null,
	rating: null,
});

/** An own property only, never one inherited from Object.prototype. */
function own(value: unknown, key: string): unknown {
	return typeof value === "object" &&
		value !== null &&
		Object.hasOwn(value, key)
		? (value as Record<string, unknown>)[key]
		: undefined;
}

const MONTH_YEAR = new Intl.DateTimeFormat("en-GB", {
	month: "long",
	year: "numeric",
	timeZone: "UTC",
});

/**
 * A day the API sent, as the page says it: "October 2026" (the month is
 * enough for a review and keeps server and browser the same: it is read in
 * UTC), or null for anything that is not a real YYYY-MM-DD day.
 */
export function dayView(value: unknown): DayView | null {
	if (typeof value !== "string") return null;
	const match = DAY.exec(value);
	if (!match) return null;
	const date = new Date(`${value}T00:00:00Z`);
	if (
		Number.isNaN(date.getTime()) ||
		date.toISOString().slice(0, 10) !== value
	) {
		return null;
	}
	return { text: MONTH_YEAR.format(date), dateTime: value };
}

/** A visible artist's tag ({ slug, name }), with their page; null for anything else. */
export function readArtistTag(
	value: unknown,
): { readonly name: string; readonly href: string } | null {
	const slug = own(value, "slug");
	if (typeof slug !== "string" || !ARTIST_SLUG.test(slug)) return null;
	const name = own(value, "name");
	return {
		name: (typeof name === "string" ? cleanLine(name) : null) ?? slug,
		href: `/artists/${slug}`,
	};
}

/** A shown name: one line, 1 to 40 characters, else null (the item is dropped). */
export function readShownName(value: unknown): string | null {
	const line = typeof value === "string" ? cleanLine(value) : null;
	return line && Array.from(line).length <= MAX_NAME ? line : null;
}

/** Plain text up to `max` characters, its line breaks kept, else null. */
function readText(value: unknown, max: number): string | null {
	const text = typeof value === "string" ? cleanText(value) : null;
	return text && Array.from(text).length <= max ? text : null;
}

function readReview(item: unknown): ReviewView | null {
	const id = own(item, "id");
	const rating = own(item, "rating");
	const body = readText(own(item, "body"), MAX_BODY);
	const name = readShownName(own(item, "shownName"));
	if (
		typeof id !== "string" ||
		!UUID.test(id) ||
		typeof rating !== "number" ||
		!Number.isInteger(rating) ||
		rating < 1 ||
		rating > 5 ||
		body === null ||
		name === null
	) {
		return null;
	}
	const reply = own(item, "reply");
	const replyBody = readText(own(reply, "body"), MAX_REPLY);
	return {
		id,
		rating,
		ratingText: fill(studioCopy.reviews.stars, { n: rating }),
		body,
		name,
		date: dayView(own(item, "date")),
		artist: readArtistTag(own(item, "artist")),
		reply:
			replyBody === null
				? null
				: { body: replyBody, date: dayView(own(reply, "date")) },
	};
}

/** The API's rating, only from 3 reviews and between 1 and 5, to one decimal. */
function readRating(value: unknown): RatingView | null {
	const average = own(value, "average");
	const count = own(value, "count");
	if (
		typeof average !== "number" ||
		!Number.isFinite(average) ||
		average < 1 ||
		average > 5 ||
		typeof count !== "number" ||
		!Number.isInteger(count) ||
		count < MIN_RATED_REVIEWS
	) {
		return null;
	}
	const averageText = (Math.round(average * 10) / 10).toFixed(1);
	return {
		average: Number(averageText),
		averageText,
		count,
		text: fill(studioCopy.reviews.summary, { average: averageText, count }),
		fromText: fill(studioCopy.reviews.summaryFrom, { count }),
		stars: Math.floor(Number(averageText)),
	};
}

/**
 * A page of reviews (`ReviewsPage`, whatever the API really sent) as the
 * reviews to show: at most 48, each with a UUID, whole stars from 1 to 5, a
 * text of up to 2,000 characters and a one-line shown name of up to 40
 * (anything else is dropped), each id once. Anything that is not a page is
 * no reviews. Pure.
 */
export function reviewsView(page: unknown): ReviewsView {
	if (typeof page !== "object" || page === null) return EMPTY_REVIEWS;
	const data = own(page, "data");
	const seen = new Set<string>();
	const reviews = (Array.isArray(data) ? data.slice(0, MAX_REVIEWS_PAGE) : [])
		.map(readReview)
		.filter((review): review is ReviewView => {
			if (review === null || seen.has(review.id)) return false;
			seen.add(review.id);
			return true;
		});
	const cursor = own(page, "nextCursor");
	return {
		reviews,
		nextCursor:
			typeof cursor === "string" && CURSOR.test(cursor) ? cursor : null,
		rating: readRating(own(page, "rating")),
	};
}

/** What `/reviews` reads from its address: only a cursor shaped like one. */
export interface ReviewsSearch {
	readonly cursor?: string;
}

/** The address's search read strictly: `cursor` when it is shaped like one; every other key dropped. */
export function readReviewsSearch(
	search: Record<string, unknown>,
): ReviewsSearch {
	const cursor = own(search, "cursor");
	return typeof cursor === "string" && CURSOR.test(cursor) ? { cursor } : {};
}

/** The API's read for this page: `cursor` (as typed: a garbled one is the API's 422) then `limit`. */
export function reviewsQuery(
	search: ReviewsSearch,
	limit: number,
): ListReviewsQuery {
	return {
		...(search.cursor ? { cursor: search.cursor } : {}),
		limit,
	};
}
