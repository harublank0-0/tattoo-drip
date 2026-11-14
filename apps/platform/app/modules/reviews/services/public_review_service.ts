import { inject } from "@adonisjs/core";
import type { DateTime } from "luxon";
import type Artist from "#modules/artists/models/artist";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ArtistService from "#modules/artists/services/artist_service";
import { knownStyles, type TattooStyleRef } from "#modules/artists/styles";
import {
	encodeWorkCursor,
	type WorkCursor,
} from "#modules/artists/work_cursor";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ImageService, { keyUnder } from "#modules/media/services/image_service";
import VideoService from "#modules/media/services/video_service";
import ClientPost from "#modules/reviews/models/client_post";
import ClientPostMedia from "#modules/reviews/models/client_post_media";
import ClientReview from "#modules/reviews/models/client_review";
import { reviewsEnabled } from "#modules/reviews/review_links";
import {
	PUBLIC_PHOTO_PURPOSE,
	PUBLIC_VIDEO_PURPOSE,
} from "#modules/reviews/services/post_publication_service";
import type {
	ShownAngle,
	ShownWorkPhoto,
} from "#modules/storefront/services/studio_page_service";
import type Tenant from "#modules/tenancy/models/tenant";
import { dbClient } from "#services/db_context";

/** The private purposes a post's originals are stored under (ClientPostService). */
const PRIVATE_PHOTO = "client_post_photo";
const PRIVATE_VIDEO = "client_post_video";

/** The studio's average and count only from this many shown reviews (ruling 10). */
export const MIN_RATED_REVIEWS = 3;

/** A tag of the artist who made the tattoo, while the studio shows them. */
export type ShownArtistTag = { slug: string; name: string };

/** A review as the studio's page shows it (openapi.yaml, StudioReview). */
export type ShownStudioReview = {
	id: string;
	rating: number;
	body: string;
	shownName: string;
	/** The day it was written, in the studio's timezone (YYYY-MM-DD). */
	date: string;
	artist: ShownArtistTag | null;
	reply: { body: string; date: string } | null;
};

/** The studio's average and count (openapi.yaml, ReviewRating). */
export type ShownReviewRating = { average: number; count: number };

/** A page of reviews before formatting (openapi.yaml, listReviews). */
export type ShownReviewsPage = {
	reviews: ShownStudioReview[];
	nextCursor: string | null;
	rating: ShownReviewRating | null;
};

/** A Fresh ink post as the studio's page shows it (openapi.yaml, FreshInkPost). */
export type ShownFreshInkPost = ShownWorkPhoto & {
	id: string;
	angles: ShownAngle[];
	shownName: string;
	caption: string | null;
	styles: TattooStyleRef[];
	placement: string | null;
	artist: ShownArtistTag | null;
	/** The day it was published on the studio's page, in its timezone (YYYY-MM-DD). */
	date: string;
};

/** A page of Fresh ink before formatting (openapi.yaml, listFreshInk). */
export type ShownFreshInkPage = {
	posts: ShownFreshInkPost[];
	nextCursor: string | null;
};

/** What listReviews and listFreshInk ask for: `limit` already within bounds. */
export type PublicPageQuery = { cursor: WorkCursor | null; limit: number };

/** A row's instant as the cursor writes it: UTC text with six fractional digits, never a JavaScript date. */
const cursorAt = (column: string) =>
	`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cursor_at`;

/**
 * What the studio's own page shows of its clients' reviews and Fresh ink
 * (Reviews and Fresh ink, slice 3; listReviews and listFreshInk), for the
 * tenant `publicTenant` resolved: a live one (a deleted studio's slug is
 * already the 404), its rows RLS-scoped to it, and every query filtered by
 * its id as well.
 *
 * A review shows while the client allows the studio's page, has not deleted
 * it and TattooDrip has not taken it down (ruling 6: the studio cannot hide
 * one, so nothing here depends on the studio's own project or client
 * records); its reply shows unless TattooDrip took the reply down. A post
 * shows while it is approved, published (`published_at`: its public copies
 * exist), allowed on the studio's page and not taken down (rulings 7, 8 and
 * 12); only those public copies are served (`fresh_ink_photo`,
 * `fresh_ink_video`), and of a video only a ready one with its poster. The
 * artist tag is the artist's slug and name only while the gallery shows that
 * artist (`ArtistService.listVisible`). Names are the shown name only (ruling
 * 9); never a client's full name, phone, email or id.
 *
 * While REVIEWS_ENABLED is off both reads are empty pages without a query:
 * the storefront's sections then render nothing.
 */
@inject()
export default class PublicReviewService {
	constructor(
		private artists: ArtistService,
		private images: ImageService,
	) {}

	/** Video files: stateless, built on the same ImageService. */
	private get videos(): VideoService {
		return new VideoService(this.images);
	}

	/**
	 * A page of the shown reviews, newest first (`created_at desc, id desc`,
	 * never "best first"), and the studio's average and count from all of
	 * them, only from MIN_RATED_REVIEWS (ruling 10). Three queries: the
	 * visible artists, the page and the rating.
	 */
	async reviews(
		tenant: Tenant,
		query: PublicPageQuery,
	): Promise<ShownReviewsPage> {
		if (!reviewsEnabled() || tenant.deletedAt) {
			return { reviews: [], nextCursor: null, rating: null };
		}
		const tags = await this.artistTags(tenant);
		const page = shownReviews(tenant)
			.select(
				"id",
				"rating",
				"body",
				"shown_name",
				"created_at",
				"artist_id",
				"reply",
				"replied_at",
				"reply_taken_down_at",
			)
			.select(dbClient().raw(cursorAt("created_at")));
		if (query.cursor) {
			page.whereRaw("(created_at, id) < (?::timestamptz, ?::uuid)", [
				query.cursor.at,
				query.cursor.id,
			]);
		}
		const rows = await page
			.orderBy("created_at", "desc")
			.orderBy("id", "desc")
			.limit(query.limit + 1);
		const kept = rows.slice(0, query.limit);
		const last = kept[query.limit - 1];
		const totals = await shownReviews(tenant)
			.select(
				dbClient().raw(
					"count(*)::int as total, round(avg(rating)::numeric, 1)::float8 as average",
				),
			)
			.first();
		const count = Number(totals?.$extras.total ?? 0);
		return {
			reviews: kept.map((row) => shownReview(tenant, row, tags)),
			nextCursor:
				rows.length > query.limit
					? encodeWorkCursor({
							at: String(last.$extras.cursor_at),
							id: last.id,
						})
					: null,
			rating:
				count >= MIN_RATED_REVIEWS
					? { average: Number(totals?.$extras.average), count }
					: null,
		};
	}

	/**
	 * A page of the shown Fresh ink posts, newest published first
	 * (`published_at desc, id desc`), each with its public copies in order
	 * (the lead, always a photo, then its other photos and ready videos).
	 * Three queries: the visible artists, the page and its media. A post
	 * whose lead has no public photo is left out (never shown half made); the
	 * cursor still moves past it.
	 */
	async freshInk(
		tenant: Tenant,
		query: PublicPageQuery,
	): Promise<ShownFreshInkPage> {
		if (!reviewsEnabled() || tenant.deletedAt) {
			return { posts: [], nextCursor: null };
		}
		const tags = await this.artistTags(tenant);
		const page = ClientPost.query()
			.select(
				"id",
				"artist_id",
				"shown_name",
				"caption",
				"styles",
				"placement",
				"published_at",
			)
			.select(dbClient().raw(cursorAt("published_at")))
			.where("tenant_id", tenant.id)
			.where("status", "approved")
			.whereNotNull("submitted_at")
			.whereNotNull("published_at")
			.where("consent_studio_page", true)
			.whereNull("taken_down_at");
		if (query.cursor) {
			page.whereRaw("(published_at, id) < (?::timestamptz, ?::uuid)", [
				query.cursor.at,
				query.cursor.id,
			]);
		}
		const rows = await page
			.orderBy("published_at", "desc")
			.orderBy("id", "desc")
			.limit(query.limit + 1);
		const kept = rows.slice(0, query.limit);
		const last = kept[query.limit - 1];
		const media =
			kept.length === 0
				? []
				: await ClientPostMedia.query()
						.where("tenant_id", tenant.id)
						.whereIn(
							"post_id",
							kept.map((post) => post.id),
						)
						.orderBy("position", "asc");
		const byPost = new Map<string, ClientPostMedia[]>();
		for (const item of media) {
			byPost.set(item.postId, [...(byPost.get(item.postId) ?? []), item]);
		}
		const posts: ShownFreshInkPost[] = [];
		for (const post of kept) {
			const shown = await this.shownPost(
				tenant,
				post,
				byPost.get(post.id) ?? [],
				tags,
			);
			if (shown) posts.push(shown);
		}
		return {
			posts,
			nextCursor:
				rows.length > query.limit
					? encodeWorkCursor({
							at: String(last.$extras.cursor_at),
							id: last.id,
						})
					: null,
		};
	}

	/** The visible artists' tags by id: the artists the gallery shows (a closed one too). */
	private async artistTags(
		tenant: Tenant,
	): Promise<Map<string, ShownArtistTag>> {
		const visible: Artist[] = await this.artists.listVisible(tenant);
		return new Map(
			visible.map((artist) => [
				artist.id,
				{ slug: artist.slug, name: artist.name },
			]),
		);
	}

	private async shownPost(
		tenant: Tenant,
		post: ClientPost,
		media: readonly ClientPostMedia[],
		tags: Map<string, ShownArtistTag>,
	): Promise<ShownFreshInkPost | null> {
		const [lead, ...rest] = media;
		if (
			!lead ||
			lead.kind !== "photo" ||
			!lead.imageKey ||
			lead.width === null ||
			lead.height === null
		) {
			return null;
		}
		const angles: ShownAngle[] = [];
		for (const item of rest) {
			const angle = await this.shownAngle(tenant, item);
			if (angle) angles.push(angle);
		}
		return {
			...(await this.shownPhoto(tenant, {
				imageKey: lead.imageKey,
				width: lead.width,
				height: lead.height,
				alt: lead.alt,
			})),
			id: post.id,
			angles,
			shownName: post.shownName,
			caption: post.caption,
			styles: knownStyles(post.styles ?? []),
			placement: post.placement,
			artist: tags.get(post.artistId) ?? null,
			date: dayOf(post.publishedAt as DateTime, tenant.timezone),
		};
	}

	/** A photo's public copy: the original's name in `fresh_ink_photo`, with its copies. */
	private async shownPhoto(
		tenant: Tenant,
		item: {
			imageKey: string;
			width: number;
			height: number;
			alt: string | null;
		},
	): Promise<ShownWorkPhoto> {
		return {
			...(await this.images.shownImage(
				PUBLIC_PHOTO_PURPOSE,
				keyUnder(item.imageKey, PRIVATE_PHOTO, PUBLIC_PHOTO_PURPOSE),
				tenant,
				{ width: item.width, height: item.height },
			)),
			alt: item.alt,
		};
	}

	/**
	 * One more photo or video of a post. A video is shown only once ready,
	 * with its poster, its renditions and its length, all public copies; one
	 * processing, failed or somehow incomplete is left out.
	 */
	private async shownAngle(
		tenant: Tenant,
		item: ClientPostMedia,
	): Promise<ShownAngle | null> {
		const { imageKey, width, height, videoKeys, videoDurationMs } = item;
		if (!imageKey || width === null || height === null) return null;
		if (item.kind === "photo") {
			return {
				kind: "photo",
				...(await this.shownPhoto(tenant, {
					imageKey,
					width,
					height,
					alt: item.alt,
				})),
			};
		}
		if (
			item.kind !== "video" ||
			item.videoState !== "ready" ||
			!videoKeys ||
			videoKeys.length === 0 ||
			videoDurationMs === null
		) {
			return null;
		}
		const sources = await this.videos.sources(
			tenant,
			videoKeys.map((key) =>
				keyUnder(key, PRIVATE_VIDEO, PUBLIC_VIDEO_PURPOSE),
			),
			PUBLIC_VIDEO_PURPOSE,
		);
		if (sources.length === 0) return null;
		return {
			kind: "video",
			poster: {
				...(await this.videos.poster(
					tenant,
					keyUnder(imageKey, PRIVATE_VIDEO, PUBLIC_VIDEO_PURPOSE),
					{ width, height },
					PUBLIC_VIDEO_PURPOSE,
				)),
				alt: item.alt,
			},
			sources,
			durationMs: videoDurationMs,
			alt: item.alt,
		};
	}
}

/**
 * The reviews the studio's page shows: allowed there by the client, not
 * taken down; the model's soft-delete scope leaves out the client's deleted
 * ones (whose rating is gone anyway).
 */
function shownReviews(tenant: Pick<Tenant, "id">) {
	return ClientReview.query()
		.where("tenant_id", tenant.id)
		.where("consent_studio_page", true)
		.whereNull("taken_down_at")
		.whereNotNull("rating");
}

function shownReview(
	tenant: Tenant,
	row: ClientReview,
	tags: Map<string, ShownArtistTag>,
): ShownStudioReview {
	const reply =
		row.reply !== null && row.repliedAt !== null && !row.replyTakenDownAt
			? { body: row.reply, date: dayOf(row.repliedAt, tenant.timezone) }
			: null;
	return {
		id: row.id,
		rating: row.rating as number,
		body: row.body,
		shownName: row.shownName,
		date: dayOf(row.createdAt, tenant.timezone),
		artist: tags.get(row.artistId) ?? null,
		reply,
	};
}

/** The day of `at` in the studio's timezone (YYYY-MM-DD); UTC for a zone the server doesn't know. */
export function dayOf(at: DateTime, timezone: string): string {
	const zoned = at.setZone(timezone);
	return (zoned.isValid ? zoned : at.toUTC()).toISODate() as string;
}
