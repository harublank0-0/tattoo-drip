import { inject } from "@adonisjs/core";
import { DateTime } from "luxon";
import { knownStyles, type TattooStyleRef } from "#modules/artists/styles";
import {
	type DiscoverCursor,
	encodeDiscoverCursor,
} from "#modules/discovery/cursor";
import { readDiscovery } from "#modules/discovery/read";
import { linkReferral } from "#modules/discovery/referral";
import {
	ARTIST_COLUMNS,
	type ArtistRow,
	type Client,
	type DiscoverLocation,
	type DiscoverPage,
	type DiscoverStudioRef,
	type LocationFilter,
	locationOf,
	placeFilter,
	placesOf,
	rowsOf,
	studioBySlug,
	studioRef,
} from "#modules/discovery/services/discovery_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ImageService from "#modules/media/services/image_service";
import VideoService from "#modules/media/services/video_service";
import { storefrontTemplate } from "#modules/payments/deposit_links";
import { reviewsEnabled } from "#modules/reviews/review_links";
import {
	PUBLIC_PHOTO_PURPOSE,
	PUBLIC_VIDEO_PURPOSE,
} from "#modules/reviews/services/post_publication_service";
import {
	dayOf,
	MIN_RATED_REVIEWS,
	type ShownReviewRating,
} from "#modules/reviews/services/public_review_service";
import type {
	ShownAngle,
	ShownWorkPhoto,
} from "#modules/storefront/services/studio_page_service";
import { bookingPageUrl, studioPageUrl } from "#services/storefront_url";

/**
 * Reviews and Fresh ink on Discover (slice 4, docs/discover/api.md,
 * "Reviews and Fresh ink"): a profile's reviews with its rating, a
 * profile's Fresh ink and the global Fresh ink feed. Like DiscoveryService,
 * every query reads only the `discovery` views (`reviews`, `fresh_ink`,
 * `fresh_ink_media`, `studios`, `artists`) and `places`, through
 * readDiscovery: no tenant or user context, read-only, rolled back. The
 * views decide what shows (rulings 8 to 11: the client's Discover consent,
 * a published and approved post, no takedown or delete, a listed studio, a
 * shown artist, a reply not taken down, ready videos only, public keys
 * only), so nothing here repeats a rule; every answer field is written out
 * from the views' columns. While REVIEWS_ENABLED is off every read is an
 * empty page without a query.
 */

/** Whose reviews or Fresh ink: a studio, an artist at a studio, or an independent artist's profile. */
export type DiscoverSubject =
	| { kind: "studio"; slug: string }
	| { kind: "studioArtist"; studio: string; artist: string }
	| { kind: "independent"; slug: string };

export type DiscoverPageQuery = {
	cursor: DiscoverCursor | null;
	limit: number;
};
export type DiscoverFreshInkQuery = LocationFilter &
	DiscoverPageQuery & { style?: string };

type ArtistRef = { id: string; slug: string; name: string };

export type DiscoverReview = {
	id: string;
	rating: number;
	body: string;
	shownName: string;
	date: string;
	artist: ArtistRef;
	studio: DiscoverStudioRef;
	reply: { body: string; date: string } | null;
};
export type DiscoverReviewsPage = DiscoverPage<DiscoverReview> & {
	rating: ShownReviewRating | null;
};
export type DiscoverFreshInkPost = ShownWorkPhoto & {
	id: string;
	angles: ShownAngle[];
	shownName: string;
	caption: string | null;
	styles: TattooStyleRef[];
	placement: string | null;
	date: string;
	artist: ArtistRef;
	studio: DiscoverStudioRef;
	location: DiscoverLocation | null;
	storefrontUrl: string;
	bookingUrl: string;
};

/** The instant as the cursor carries it (DiscoveryService's `newest`). */
const AT_TEXT = (column: string) =>
	`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/** The joined artist and studio columns of a review or a post. */
const OWNER_COLUMNS = `a.slug as artist_slug, a.name as artist_name,
	s.slug as studio_slug, s.name as studio_name, s.type as studio_type,
	s.place_id, s.timezone`;

type OwnerRow = {
	studio_id: string;
	artist_id: string;
	artist_slug: string;
	artist_name: string;
	studio_slug: string;
	studio_name: string;
	studio_type: "studio" | "independent";
	place_id: string | null;
	timezone: string;
	cursor_value: string;
};
type ReviewRow = OwnerRow & {
	id: string;
	rating: number;
	body: string;
	shown_name: string;
	reply: string | null;
	replied_at: Date | null;
	created_at: Date;
};
type PostRow = OwnerRow & {
	id: string;
	shown_name: string;
	caption: string | null;
	styles: string[];
	placement: string | null;
	published_at: Date;
};
type MediaRow = {
	post_id: string;
	position: number;
	kind: "photo" | "video";
	image_key: string;
	width: number;
	height: number;
	alt: string | null;
	video_keys: string[] | null;
	video_duration_ms: number | null;
};

/** The empty answers while reviews are switched off on the platform. */
const NO_REVIEWS: DiscoverReviewsPage = {
	items: [],
	nextCursor: null,
	rating: null,
};
const NO_POSTS: DiscoverPage<DiscoverFreshInkPost> = {
	items: [],
	nextCursor: null,
};

@inject()
export default class DiscoverReviewService {
	constructor(private images: ImageService) {}

	/** Video files: stateless, built on the same ImageService. */
	private get videos(): VideoService {
		return new VideoService(this.images);
	}

	/**
	 * A profile's reviews, newest first (`created_at desc, id desc`), and its
	 * average and count from all of them, only from MIN_RATED_REVIEWS
	 * (ruling 10); null for a profile Discover does not show (the 404).
	 */
	async reviews(
		subject: DiscoverSubject,
		query: DiscoverPageQuery,
	): Promise<DiscoverReviewsPage | null> {
		if (!reviewsEnabled()) return NO_REVIEWS;
		return readDiscovery(async (client) => {
			const owner = await resolve(client, subject);
			if (!owner) return null;
			const bindings: unknown[] = [owner.studioId];
			let where = "r.studio_id = ?::uuid";
			if (owner.artistId) {
				where += " and r.artist_id = ?::uuid";
				bindings.push(owner.artistId);
			}
			const totals = await rowsOf<{ total: number; average: number | null }>(
				client,
				`select count(*)::int as total, round(avg(r.rating)::numeric, 1)::float8 as average
				 from discovery.reviews r where ${where}`,
				bindings,
			);
			let page = where;
			const pageBindings = [...bindings];
			if (query.cursor) {
				page += " and (r.created_at, r.id) < (?::timestamptz, ?::uuid)";
				pageBindings.push(query.cursor.value, query.cursor.id);
			}
			const rows = await rowsOf<ReviewRow>(
				client,
				`select r.id, r.studio_id, r.artist_id, r.rating, r.body, r.shown_name,
				        r.reply, r.replied_at, r.created_at, ${AT_TEXT("r.created_at")} as cursor_value,
				        ${OWNER_COLUMNS}
				 from discovery.reviews r
				 join discovery.artists a on a.id = r.artist_id
				 join discovery.studios s on s.id = r.studio_id
				 where ${page}
				 order by r.created_at desc, r.id desc limit ?`,
				[...pageBindings, query.limit + 1],
			);
			const count = totals[0]?.total ?? 0;
			return {
				items: rows.slice(0, query.limit).map(reviewOf),
				nextCursor: cursorAfter(rows, query.limit),
				rating:
					count >= MIN_RATED_REVIEWS && totals[0]?.average != null
						? { average: Number(totals[0].average), count }
						: null,
			};
		});
	}

	/**
	 * Fresh ink, newest published first (`published_at desc, id desc`): a
	 * profile's (`subject`; null for a profile Discover does not show) or the
	 * global feed's (no subject), filtered by place and style. The page is
	 * read from `discovery.fresh_ink` alone and only its rows are joined to
	 * their artist and studio (DiscoveryService.tattoos' shape), then its
	 * media in one query. A post whose lead is not a public photo is left
	 * out (never shown half made); the cursor still moves past it.
	 */
	async freshInk(
		subject: DiscoverSubject | null,
		query: DiscoverFreshInkQuery,
	): Promise<DiscoverPage<DiscoverFreshInkPost> | null> {
		if (!reviewsEnabled()) return NO_POSTS;
		return readDiscovery(async (client) => {
			const bindings: unknown[] = [];
			let where = "true";
			if (subject) {
				const owner = await resolve(client, subject);
				if (!owner) return null;
				where += " and f.studio_id = ?::uuid";
				bindings.push(owner.studioId);
				if (owner.artistId) {
					where += " and f.artist_id = ?::uuid";
					bindings.push(owner.artistId);
				}
			}
			const place = placeFilter(query);
			if (place.sql) {
				where += ` and f.studio_id in (select s.id from discovery.studios s where true${place.sql})`;
				bindings.push(...place.bindings);
			}
			if (query.style) {
				where += " and f.styles @> array[?]::varchar[]";
				bindings.push(query.style);
			}
			if (query.cursor) {
				where += " and (f.published_at, f.id) < (?::timestamptz, ?::uuid)";
				bindings.push(query.cursor.value, query.cursor.id);
			}
			const rows = await rowsOf<PostRow>(
				client,
				`select f.id, f.studio_id, f.artist_id, f.shown_name, f.caption, f.styles,
				        f.placement, f.published_at, ${AT_TEXT("f.published_at")} as cursor_value,
				        ${OWNER_COLUMNS}
				 from (select f.* from discovery.fresh_ink f where ${where}
				       order by f.published_at desc, f.id desc limit ?) f
				 join discovery.artists a on a.id = f.artist_id
				 join discovery.studios s on s.id = f.studio_id
				 order by f.published_at desc, f.id desc`,
				[...bindings, query.limit + 1],
			);
			const page = rows.slice(0, query.limit);
			const media =
				page.length === 0
					? []
					: await rowsOf<MediaRow>(
							client,
							`select m.post_id, m.position, m.kind, m.image_key, m.width, m.height,
							        m.alt, m.video_keys, m.video_duration_ms
							 from discovery.fresh_ink_media m
							 where m.post_id = any(?::uuid[]) order by m.post_id, m.position`,
							[page.map(({ id }) => id)],
						);
			const byPost = new Map<string, MediaRow[]>();
			for (const item of media) {
				byPost.set(item.post_id, [...(byPost.get(item.post_id) ?? []), item]);
			}
			const places = await placesOf(
				client,
				page.map(({ place_id }) => place_id),
			);
			const items: DiscoverFreshInkPost[] = [];
			for (const row of page) {
				const post = await this.postOf(row, byPost.get(row.id) ?? []);
				if (post)
					items.push({ ...post, location: locationOf(row.place_id, places) });
			}
			return { items, nextCursor: cursorAfter(rows, query.limit) };
		});
	}

	private async postOf(
		row: PostRow,
		media: readonly MediaRow[],
	): Promise<Omit<DiscoverFreshInkPost, "location"> | null> {
		const [lead, ...rest] = media;
		if (!lead || lead.position !== 0 || lead.kind !== "photo") return null;
		const tenant = { id: row.studio_id };
		const angles: ShownAngle[] = [];
		for (const item of rest) {
			const angle = await this.angleOf(tenant, item);
			if (angle) angles.push(angle);
		}
		return {
			...(await this.photoOf(tenant, lead)),
			id: row.id,
			angles,
			shownName: row.shown_name,
			caption: row.caption,
			styles: knownStyles(row.styles ?? []),
			placement: row.placement,
			date: dayOf(DateTime.fromJSDate(row.published_at), row.timezone),
			artist: artistOf(row),
			studio: studioRef(row),
			storefrontUrl: studioPageUrl(storefrontTemplate(), row.studio_slug),
			bookingUrl: bookingPageUrl(storefrontTemplate(), row.studio_slug, {
				artist: row.artist_slug,
				ref: linkReferral(row.studio_id),
			}),
		};
	}

	/** A photo's public copy (the view's key is already the public one). */
	private async photoOf(
		tenant: { id: string },
		item: MediaRow,
	): Promise<ShownWorkPhoto> {
		return {
			...(await this.images.shownImage(
				PUBLIC_PHOTO_PURPOSE,
				item.image_key,
				tenant,
				{ width: item.width, height: item.height },
			)),
			alt: item.alt,
		};
	}

	/** One more photo or ready video (the view lists no other video). */
	private async angleOf(
		tenant: { id: string },
		item: MediaRow,
	): Promise<ShownAngle | null> {
		if (item.kind === "photo") {
			return { kind: "photo", ...(await this.photoOf(tenant, item)) };
		}
		if (!item.video_keys?.length || item.video_duration_ms === null) {
			return null;
		}
		const sources = await this.videos.sources(
			tenant,
			item.video_keys,
			PUBLIC_VIDEO_PURPOSE,
		);
		if (sources.length === 0) return null;
		return {
			kind: "video",
			poster: {
				...(await this.videos.poster(
					tenant,
					item.image_key,
					{ width: item.width, height: item.height },
					PUBLIC_VIDEO_PURPOSE,
				)),
				alt: item.alt,
			},
			sources,
			durationMs: item.video_duration_ms,
			alt: item.alt,
		};
	}
}

/**
 * The studio (and artist) a subject names, by DiscoveryService's rules: a
 * studio by its current or an old slug; an artist by the studio's slug and
 * theirs; an independent artist's profile by their business's slug (its
 * first-made shown artist). Null when Discover does not show it.
 */
async function resolve(
	client: Client,
	subject: DiscoverSubject,
): Promise<{ studioId: string; artistId: string | null } | null> {
	if (subject.kind === "studio") {
		const studio = await studioBySlug(client, subject.slug, "studio");
		return studio ? { studioId: studio.id, artistId: null } : null;
	}
	if (subject.kind === "studioArtist") {
		const studio = await studioBySlug(client, subject.studio, "studio");
		if (!studio) return null;
		const [artist] = await rowsOf<Pick<ArtistRow, "id">>(
			client,
			"select a.id from discovery.artists a where a.studio_id = ? and a.slug = ?",
			[studio.id, subject.artist],
		);
		return artist ? { studioId: studio.id, artistId: artist.id } : null;
	}
	const business = await studioBySlug(client, subject.slug, "independent");
	if (!business) return null;
	const [artist] = await rowsOf<ArtistRow>(
		client,
		`select ${ARTIST_COLUMNS} from discovery.artists a
		 join discovery.studios s on s.id = a.studio_id
		 where a.studio_id = ? order by a.created_at asc, a.id asc limit 1`,
		[business.id],
	);
	return artist ? { studioId: business.id, artistId: artist.id } : null;
}

function artistOf(row: OwnerRow): ArtistRef {
	return { id: row.artist_id, slug: row.artist_slug, name: row.artist_name };
}

function reviewOf(row: ReviewRow): DiscoverReview {
	return {
		id: row.id,
		rating: row.rating,
		body: row.body,
		shownName: row.shown_name,
		date: dayOf(DateTime.fromJSDate(row.created_at), row.timezone),
		artist: artistOf(row),
		studio: studioRef(row),
		reply:
			row.reply !== null && row.replied_at !== null
				? {
						body: row.reply,
						date: dayOf(DateTime.fromJSDate(row.replied_at), row.timezone),
					}
				: null,
	};
}

/** The `newest` cursor after a page of `limit` rows when one more came back. */
function cursorAfter(
	rows: { id: string; cursor_value: string }[],
	limit: number,
): string | null {
	if (rows.length <= limit) return null;
	const last = rows[limit - 1];
	return encodeDiscoverCursor({
		sort: "newest",
		value: last.cursor_value,
		id: last.id,
	});
}
