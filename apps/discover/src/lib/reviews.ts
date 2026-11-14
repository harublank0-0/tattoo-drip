import { queryOptions } from "@tanstack/react-query";
import { discoverKeys } from "@tattoo-drip/react";
import type {
	DiscoverClient,
	DiscoverFreshInkPage,
	DiscoverFreshInkPost,
	DiscoverProfilePageQuery,
	DiscoverReview,
	DiscoverReviewsPage,
	ReviewRating,
} from "@tattoo-drip/sdk";
import type { PublicSettings } from "./config.ts";
import { paths } from "./routes.ts";
import { siteUrl } from "./seo.ts";
import type { JsonLd } from "./structured-data.ts";

/**
 * Reviews and Fresh ink on Discover (slice 4; docs/discover/frontend.md,
 * "Reviews and Fresh ink"): the profiles' reads, the words a rating is said
 * in, and the reviews' structured data. Pure but for the query options.
 *
 * The API shows only what the studio and the client both allowed (the
 * client's Discover consent, a listed studio, a shown artist; ruling 11),
 * and an empty page renders nothing: no heading, no "no reviews yet".
 */

/** The reviews a profile shows at first, then "Show more reviews" (a page each). */
export const PROFILE_REVIEWS = 6;
/** The Fresh ink posts a profile shows at first, then "Show more Fresh ink". */
export const PROFILE_FRESH_INK = 8;
/** An average and a count only from this many reviews (ruling 10; the API already says null below). */
export const MIN_RATED_REVIEWS = 3;

/** Whose reviews and Fresh ink a profile reads: the API's three profile shapes. */
export type ReviewSubject =
	| { kind: "studio"; slug: string }
	| { kind: "studioArtist"; studio: string; artist: string }
	| { kind: "independent"; slug: string };

/**
 * A profile's reviews and Fresh ink reads (`cursor` for a later page): the
 * same keys and requests as `discoverQueries` (`studioReviews`,
 * `studioArtistReviews`, `independentArtistReviews` and their Fresh ink),
 * with one type whatever the profile.
 */
export function profileReviewQueries(
	client: DiscoverClient,
	subject: ReviewSubject,
	cursors: { reviews?: string; freshInk?: string } = {},
) {
	const reviews: DiscoverProfilePageQuery = {
		limit: PROFILE_REVIEWS,
		...(cursors.reviews ? { cursor: cursors.reviews } : {}),
	};
	const freshInk: DiscoverProfilePageQuery = {
		limit: PROFILE_FRESH_INK,
		...(cursors.freshInk ? { cursor: cursors.freshInk } : {}),
	};
	const pick = <T>(studio: T, studioArtist: T, independent: T): T =>
		subject.kind === "studio"
			? studio
			: subject.kind === "studioArtist"
				? studioArtist
				: independent;
	const slug = subject.kind === "studioArtist" ? subject.studio : subject.slug;
	const artist = subject.kind === "studioArtist" ? subject.artist : "";
	return {
		reviews: queryOptions({
			queryKey: pick<readonly unknown[]>(
				discoverKeys.studioReviews(slug, reviews),
				discoverKeys.studioArtistReviews(slug, artist, reviews),
				discoverKeys.independentArtistReviews(slug, reviews),
			),
			queryFn: ({ signal }): Promise<DiscoverReviewsPage> =>
				pick(
					() => client.studios.reviews(slug, reviews, { signal }),
					() => client.studios.artistReviews(slug, artist, reviews, { signal }),
					() => client.artists.independentReviews(slug, reviews, { signal }),
				)(),
		}),
		freshInk: queryOptions({
			queryKey: pick<readonly unknown[]>(
				discoverKeys.studioFreshInk(slug, freshInk),
				discoverKeys.studioArtistFreshInk(slug, artist, freshInk),
				discoverKeys.independentArtistFreshInk(slug, freshInk),
			),
			queryFn: ({ signal }): Promise<DiscoverFreshInkPage> =>
				pick(
					() => client.studios.freshInk(slug, freshInk, { signal }),
					() =>
						client.studios.artistFreshInk(slug, artist, freshInk, { signal }),
					() => client.artists.independentFreshInk(slug, freshInk, { signal }),
				)(),
		}),
	};
}

/** A profile's own country when it is one of Discover's markets (the feed's link keeps it), else none. */
export function marketOf(
	location: { country: string } | null | undefined,
	markets: readonly string[],
): string | undefined {
	return location && markets.includes(location.country)
		? location.country
		: undefined;
}

/** One string per profile: the sections are keyed by it, so another profile starts them again. */
export function subjectKey(subject: ReviewSubject): string {
	return subject.kind === "studioArtist"
		? `studioArtist:${subject.studio}/${subject.artist}`
		: `${subject.kind}:${subject.slug}`;
}

/** The first pages a profile renders: either may be missing (a failed optional read). */
export type ProfileClientContent = {
	reviews?: DiscoverReviewsPage;
	freshInk?: DiscoverFreshInkPage;
};

/** "4 out of 5": a rating said in words (a star row is only decoration). */
export function ratingWords(rating: number): string {
	return `${rating} out of 5`;
}

/**
 * The stars an average fills: whole stars, rounded down, never up (4.7
 * fills 4), between 0 and 5. The number itself is said in words beside it.
 */
export function filledStars(average: number): number {
	if (!Number.isFinite(average)) return 0;
	return Math.min(5, Math.max(0, Math.floor(average)));
}

/** "4.7" (always one decimal). */
export function averageText(average: number): string {
	return average.toFixed(1);
}

/**
 * "4.7 from 12 reviews", only from MIN_RATED_REVIEWS (the API sends null
 * below; this never says an average of fewer).
 */
export function ratingSummary(
	rating: ReviewRating | null | undefined,
): string | null {
	if (!rating || rating.count < MIN_RATED_REVIEWS) return null;
	return `${averageText(rating.average)} from ${rating.count} reviews`;
}

/** A day from the API (YYYY-MM-DD) as words ("12 October 2026"), read in UTC so it never shifts. */
export function dayText(day: string): string {
	const date = new Date(`${day}T00:00:00Z`);
	if (Number.isNaN(date.getTime())) return day;
	return new Intl.DateTimeFormat("en-GB", {
		day: "numeric",
		month: "long",
		year: "numeric",
		timeZone: "UTC",
	}).format(date);
}

/** What a post's photo shows, for its `alt`: the client's own text, else built from the data. */
export function freshInkAlt(
	post: Pick<DiscoverFreshInkPost, "alt" | "artist">,
	position?: { index: number; total: number },
): string {
	const own = post.alt?.trim();
	if (own) return own;
	const base = `Healed tattoo by ${post.artist.name}`;
	return position && position.total > 1
		? `${base}, photo ${position.index + 1} of ${position.total}`
		: base;
}

/** "Video, 0:42" for a video with no alt text of its own. */
export function videoLabel(durationMs: number): string {
	const seconds = Math.max(1, Math.round(durationMs / 1000));
	return `Video, ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * What a post holds, counting only what the viewer shows (its photos and
 * ready videos): "1 photo", "3 photos", "2 photos and a video", "1 photo
 * and 2 videos".
 */
export function mediaWords(post: Pick<DiscoverFreshInkPost, "angles">): string {
	const photos =
		1 + post.angles.filter((angle) => angle.kind === "photo").length;
	const videos = post.angles.filter((angle) => angle.kind === "video").length;
	const shown = `${photos} ${photos === 1 ? "photo" : "photos"}`;
	if (videos === 0) return shown;
	return `${shown} and ${videos === 1 ? "a video" : `${videos} videos`}`;
}

/** A tile's badge: `mediaWords`, or null for a post of one photo. */
export function mediaCount(
	post: Pick<DiscoverFreshInkPost, "angles">,
): string | null {
	return post.angles.some(
		(angle) => angle.kind === "photo" || angle.kind === "video",
	)
		? mediaWords(post)
		: null;
}

/**
 * Whose a post's booking is, by the artwork page's rule (D08/D09): an
 * artist taking requests gets "Request with <artist>"; a studio's artist
 * who isn't gets the studio's general request ("Request a session at
 * <studio>"); a paused independent artist gets none.
 */
export function freshInkBooking(
	post: Pick<
		DiscoverFreshInkPost,
		"artistAcceptingInquiries" | "artist" | "studio"
	>,
	request: string | null,
	general: (request: string) => string,
): { request: string | null; label: string; closed?: string } {
	if (post.artistAcceptingInquiries)
		return { request, label: `Request with ${post.artist.name}` };
	const closed = `${post.artist.name} isn't taking new requests right now.`;
	if (post.studio.type === "independent")
		return { request: null, label: "", closed };
	return {
		request: request ? general(request) : null,
		label: `Request a session at ${post.studio.name}`,
		closed,
	};
}

/** The pages a "Show more" list holds, merged, without repeating an id. */
export function mergePages<T extends { id: string }>(
	pages: readonly { data: readonly T[] }[],
): T[] {
	const seen = new Set<string>();
	const merged: T[] = [];
	for (const page of pages) {
		for (const item of page.data) {
			if (seen.has(item.id)) continue;
			seen.add(item.id);
			merged.push(item);
		}
	}
	return merged;
}

type Settings = Pick<PublicSettings, "siteUrl">;

/**
 * A studio profile's review markup (ruling 10, D10's `structuredData`):
 * `aggregateRating` and the reviews the page shows as `review`, for the
 * TattooParlor node, only from MIN_RATED_REVIEWS. Nothing below that, and
 * never on an artist (schema.org's `aggregateRating` has no Person in its
 * domain) or on the Fresh ink feed. Only what the page shows: the same
 * average, count and reviews, the shown name, never a client's details.
 */
export function reviewsLd(
	settings: Settings,
	studioSlug: string,
	page: DiscoverReviewsPage | undefined,
): Partial<Pick<JsonLd, "aggregateRating" | "review">> {
	const rating = page?.rating;
	if (!page || !rating || rating.count < MIN_RATED_REVIEWS) return {};
	const url = siteUrl(settings, paths.studio(studioSlug));
	return {
		aggregateRating: {
			"@type": "AggregateRating",
			ratingValue: Number(averageText(rating.average)),
			reviewCount: rating.count,
			bestRating: 5,
			worstRating: 1,
		},
		review: page.data.map((review: DiscoverReview) => ({
			"@type": "Review",
			"@id": `${url}#review-${review.id}`,
			reviewRating: {
				"@type": "Rating",
				ratingValue: review.rating,
				bestRating: 5,
				worstRating: 1,
			},
			author: { "@type": "Person", name: review.shownName },
			datePublished: review.date,
			reviewBody: review.body,
		})),
	};
}
