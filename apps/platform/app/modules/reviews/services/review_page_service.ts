import { inject } from "@adonisjs/core";
import type { DateTime } from "luxon";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ArtistService from "#modules/artists/services/artist_service";
import {
	knownStyles,
	STYLE_SLUGS,
	type TattooStyleRef,
} from "#modules/artists/styles";
import ClientService from "#modules/clients/services/client_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import PublicationService from "#modules/discovery/services/publication_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import InquiryService from "#modules/inquiries/services/inquiry_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ImageService, {
	type ShownImage,
} from "#modules/media/services/image_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import VideoService, {
	type ShownVideoSource,
} from "#modules/media/services/video_service";
import { STUCK_AFTER_MINUTES, VIDEO_STUCK } from "#modules/media/video";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ProjectService from "#modules/projects/services/project_service";
import {
	ReviewInputError,
	ReviewPageNotFoundError,
} from "#modules/reviews/errors";
import type ClientPost from "#modules/reviews/models/client_post";
import type ClientPostMedia from "#modules/reviews/models/client_post_media";
import type ClientReview from "#modules/reviews/models/client_review";
import type { ReviewContext } from "#modules/reviews/review_context";
import {
	defaultShownName,
	MAX_PLACEMENT_LENGTH,
	MAX_POST_STYLES,
} from "#modules/reviews/rules";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ClientPostService, {
	PHOTO_PURPOSE,
	type SharedChoices,
	VIDEO_PURPOSE,
} from "#modules/reviews/services/client_post_service";
import ClientReviewService from "#modules/reviews/services/client_review_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ReviewLinkService from "#modules/reviews/services/review_link_service";
import type { ReviewPageSubmission } from "#modules/reviews/validators/review_page";
import { REVIEW_MESSAGES } from "#modules/reviews/validators/review_page";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import SessionService from "#modules/scheduling/services/session_service";
import type Tenant from "#modules/tenancy/models/tenant";
import { withTransaction } from "#services/db_context";

/** One photo or video of the post as the client's page shows it. */
export type ShownMedia = {
	id: string;
	kind: "photo" | "video";
	state: "ready" | "processing" | "failed";
	failure: string | null;
	/** A photo, or a ready video's poster. */
	image: ShownImage | null;
	/** A ready video's renditions, smallest first. */
	sources: ShownVideoSource[];
	durationMs: number | null;
};

/** What the client's review page shows (openapi.yaml, ReviewPage). */
export type ReviewPage = {
	studioName: string;
	/** Whether Discover lists the studio now: the Discover consent is offered only then. */
	listedOnDiscover: boolean;
	artistName: string | null;
	/** The day of the latest completed tattoo session, in the studio's timezone (yyyy-MM-dd). */
	tattooedOn: string;
	linkExpiresAt: DateTime;
	styles: TattooStyleRef[];
	defaults: { shownName: string; styles: string[]; placement: string | null };
	review: ClientReview | null;
	post: { post: ClientPost; media: ShownMedia[] } | null;
};

/**
 * The client's review page (Reviews and Fresh ink, slice 1): a review
 * link's token opens it (`open`), and everything it reads and writes is the
 * link's project's, never anything a request names. The rating and review
 * and the Fresh ink post are written by `submit` in one transaction, with
 * the shown name and the two consents, which they share; each can be
 * deleted on its own. Photos and videos are added and removed one at a time
 * (ClientPostService).
 */
@inject()
export default class ReviewPageService {
	private clients = new ClientService();
	private reviews = new ClientReviewService();

	constructor(
		private links: ReviewLinkService,
		private projects: ProjectService,
		private sessions: SessionService,
		private artists: ArtistService,
		private inquiries: InquiryService,
		private publication: PublicationService,
		private posts: ClientPostService,
		private images: ImageService,
		private videos: VideoService,
	) {}

	/**
	 * What the link of `token` opens in this tenant, or ReviewPageNotFoundError
	 * for every link that doesn't work: unknown, revoked, expired, another
	 * studio's, or its project, client or completed tattoo session gone.
	 */
	async open(tenant: Tenant, token: string): Promise<ReviewContext> {
		const link = await this.links.resolve(tenant, token);
		if (!link) throw new ReviewPageNotFoundError();
		const project = await this.projects.findLive(tenant, link.projectId);
		if (!project) throw new ReviewPageNotFoundError();
		const client = await this.clients.find(tenant, project.clientId);
		if (!client) throw new ReviewPageNotFoundError();
		const session = await this.sessions.lastCompletedTattoo(tenant, project);
		if (!session) throw new ReviewPageNotFoundError();
		return {
			tenant,
			link,
			project,
			client,
			artistId: project.artistId ?? session.artistId,
			tattooedAt: session.endsAt,
		};
	}

	/** The page as it is now. */
	async show(ctx: ReviewContext): Promise<ReviewPage> {
		const { tenant, project } = ctx;
		const review = await this.reviews.find(tenant, project.id);
		const post = await this.posts.find(tenant, project.id);
		const media = post ? await this.posts.mediaOf(tenant, post) : [];
		const artists = await this.artists.list(tenant);
		const inquiry = project.inquiryId
			? await this.inquiries.find(tenant, project.inquiryId)
			: null;
		// Last, and alone: readDiscovery clears the context in a savepoint.
		const listedOnDiscover = await this.publication.listedNow(tenant);

		const styles = studioStyles(artists.map((artist) => artist.styles));
		const allowed = new Set<string>(styles.map(({ slug }) => slug));
		const placement = inquiry?.placement?.trim() ?? "";
		const shown: ShownMedia[] = [];
		for (const item of media) shown.push(await this.shownMedia(tenant, item));
		return {
			studioName: tenant.name,
			listedOnDiscover,
			artistName:
				artists.find((artist) => artist.id === ctx.artistId)?.name ?? null,
			tattooedOn:
				ctx.tattooedAt.setZone(tenant.timezone).toISODate() ??
				ctx.tattooedAt.toUTC().toISODate() ??
				"",
			linkExpiresAt: ctx.link.expiresAt,
			styles,
			defaults: {
				shownName:
					review?.shownName ??
					post?.shownName ??
					defaultShownName(ctx.client.name),
				styles:
					inquiry?.style && allowed.has(inquiry.style) ? [inquiry.style] : [],
				placement:
					placement && Array.from(placement).length <= MAX_PLACEMENT_LENGTH
						? placement
						: null,
			},
			review,
			post: post ? { post, media: shown } : null,
		};
	}

	/**
	 * The client's submit: the review, the post or both, with the shown name
	 * and the consents applied to every live item of the project (ruling 8:
	 * consent is per surface and always withdrawable). The Discover consent is
	 * taken only while Discover lists the studio; otherwise the stored choice
	 * stays (false for a new item). Styles must be the studio's
	 * (ReviewInputError). A submit that leaves neither a review nor a
	 * submitted post is refused.
	 */
	async submit(ctx: ReviewContext, input: ReviewPageSubmission): Promise<void> {
		const { tenant, project } = ctx;
		const listed = await this.publication.listedNow(tenant);
		if (input.post) {
			const artists = await this.artists.list(tenant);
			const allowed = new Set<string>(
				studioStyles(artists.map((artist) => artist.styles)).map(
					({ slug }) => slug,
				),
			);
			if (
				input.post.styles.length > MAX_POST_STYLES ||
				input.post.styles.some((slug) => !allowed.has(slug))
			) {
				throw new ReviewInputError("post.styles", REVIEW_MESSAGES.styles);
			}
		}
		await withTransaction(async (trx) => {
			await this.posts.lockProject(trx, ctx);
			const review = await this.reviews.find(tenant, project.id, trx);
			const post = await this.posts.find(tenant, project.id);
			const shared: SharedChoices = {
				shownName: input.shownName,
				consentStudioPage: input.consentStudioPage,
				consentDiscover: listed
					? input.consentDiscover
					: (review?.consentDiscover ?? post?.consentDiscover ?? false),
			};
			if (!input.review && !input.post && !review && !post?.submittedAt) {
				throw new ReviewInputError("review", REVIEW_MESSAGES.nothing);
			}
			if (input.review) {
				await this.reviews.save(trx, ctx, input.review, shared);
			}
			if (input.post) {
				const saved = await this.posts.save(trx, ctx, input.post);
				if (saved === "needs_media") {
					throw new ReviewInputError("post", REVIEW_MESSAGES.needsMedia);
				}
			}
			await this.reviews.applyShared(trx, ctx, shared);
			await this.posts.applyShared(trx, ctx, shared);
		});
	}

	/** The client deletes their review. */
	async deleteReview(ctx: ReviewContext): Promise<void> {
		await withTransaction(async (trx) => {
			await this.posts.lockProject(trx, ctx);
			await this.reviews.delete(trx, ctx);
		});
	}

	/** The client deletes their post, its photos and videos with it. */
	async deletePost(ctx: ReviewContext): Promise<void> {
		await this.posts.delete(ctx);
	}

	/** The shown name and consents a new draft post starts with: the review's, else the defaults. */
	async sharedFor(ctx: ReviewContext): Promise<SharedChoices> {
		const review = await this.reviews.find(ctx.tenant, ctx.project.id);
		return {
			shownName: review?.shownName ?? defaultShownName(ctx.client.name),
			consentStudioPage: review?.consentStudioPage ?? false,
			consentDiscover: review?.consentDiscover ?? false,
		};
	}

	private async shownMedia(
		tenant: Pick<Tenant, "id">,
		item: ClientPostMedia,
	): Promise<ShownMedia> {
		if (item.kind === "photo") {
			return {
				id: item.id,
				kind: "photo",
				state: "ready",
				failure: null,
				image:
					item.imageKey && item.width && item.height
						? await this.images.shownImage(
								PHOTO_PURPOSE,
								item.imageKey,
								tenant,
								{
									width: item.width,
									height: item.height,
								},
							)
						: null,
				sources: [],
				durationMs: null,
			};
		}
		if (
			item.videoState === "ready" &&
			item.imageKey &&
			item.width &&
			item.height
		) {
			return {
				id: item.id,
				kind: "video",
				state: "ready",
				failure: null,
				image: await this.videos.poster(
					tenant,
					item.imageKey,
					{ width: item.width, height: item.height },
					VIDEO_PURPOSE,
				),
				sources: await this.videos.sources(
					tenant,
					item.videoKeys ?? [],
					VIDEO_PURPOSE,
				),
				durationMs: item.videoDurationMs,
			};
		}
		// A video the worker never finished within the hour reads as failed,
		// so the client can remove it and try again (the work videos' sweep
		// says the same words to the studio).
		const stuck =
			item.videoState === "processing" &&
			item.createdAt.diffNow("minutes").minutes <= -STUCK_AFTER_MINUTES;
		return {
			id: item.id,
			kind: "video",
			state: item.videoState === "failed" || stuck ? "failed" : "processing",
			failure: stuck ? VIDEO_STUCK : item.videoFailure,
			image: null,
			sources: [],
			durationMs: null,
		};
	}
}

/**
 * The styles a post may carry (ruling 5, "the studio's list"): the styles
 * the studio's live artists list, in the platform's order; the whole
 * platform list when none of them has chosen any.
 */
export function studioStyles(
	artistStyles: readonly (readonly string[])[],
): TattooStyleRef[] {
	const chosen = knownStyles(artistStyles.flat());
	return chosen.length > 0 ? chosen : knownStyles(STYLE_SLUGS);
}
