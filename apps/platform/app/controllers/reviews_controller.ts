import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { tenantContext } from "#middleware/tenant_middleware";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ArtistService from "#modules/artists/services/artist_service";
import { knownStyles } from "#modules/artists/styles";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ClientService from "#modules/clients/services/client_service";
import { ImageDeleteError } from "#modules/media/errors";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ImageService, {
	THUMBNAIL_WIDTH,
} from "#modules/media/services/image_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import VideoService from "#modules/media/services/video_service";
import { ALERT_EXCERPT_LENGTH, excerpt } from "#modules/notifications/alerts";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ProjectService from "#modules/projects/services/project_service";
import type ClientPost from "#modules/reviews/models/client_post";
import type ClientPostMedia from "#modules/reviews/models/client_post_media";
import type ClientReview from "#modules/reviews/models/client_review";
import { parseReviewsQuery, reviewsBack } from "#modules/reviews/reviews_page";
import {
	MAX_REPLY_LENGTH,
	MAX_REPORT_NOTE_LENGTH,
	REPORT_LABELS,
	REPORT_REASONS,
	TAKEDOWN_SENTENCES,
	type TakedownReason,
} from "#modules/reviews/rules";
import {
	PHOTO_PURPOSE,
	VIDEO_PURPOSE,
} from "#modules/reviews/services/client_post_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import StudioReviewService, {
	StudioReviewRuleError,
} from "#modules/reviews/services/studio_review_service";
import {
	consentText,
	dayText,
	postStatusText,
	ratingText,
	STUDIO_DONE,
	STUDIO_RULE_MESSAGES,
} from "#modules/reviews/studio_copy";
import {
	replyValidator,
	reportValidator,
} from "#modules/reviews/validators/studio";
import type Tenant from "#modules/tenancy/models/tenant";

/** What TattooDrip's takedown says on the studio's page: the reason's fixed sentence, about the client's item. */
function takedownText(reason: string | null): string {
	return (
		TAKEDOWN_SENTENCES[(reason ?? "other") as TakedownReason] ??
		TAKEDOWN_SENTENCES.other
	).replace(" because you asked us to", " at the client's request");
}

/**
 * The Reviews page (Reviews and Fresh ink, slice 2): Fresh ink posts to
 * approve, decline or unpublish, and the published reviews to reply to or
 * report to TattooDrip. Owners see every one, an artist those of projects
 * assigned to their own profile (StudioReviewService, ProjectService's
 * findFor rule); anything else is a 404. Behind REVIEWS_ENABLED (the
 * `reviewsOn` middleware). There is no route that edits or hides a review
 * or edits a post (rulings 6 and 7): only the reply, the report and the
 * decision.
 */
@inject()
export default class ReviewsController {
	constructor(
		private reviews: StudioReviewService,
		private projects: ProjectService,
		private artists: ArtistService,
		private clients: ClientService,
		private images: ImageService,
		private videos: VideoService,
	) {}

	async index(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const owner = membership.role === "owner";
		const query = parseReviewsQuery(ctx.request.qs());
		const artists = await this.artists.list(tenant);
		// Owners may narrow to one of the studio's artists; anything else is ignored.
		const artistId =
			owner && artists.some(({ id }) => id === query.artist)
				? query.artist
				: null;
		const waiting = await this.reviews.waitingCount(tenant, membership);

		const found =
			query.view === "posts"
				? await this.reviews.postsPage(tenant, membership, {
						filter: query.posts,
						artistId,
						page: query.page,
					})
				: await this.reviews.reviewsPage(tenant, membership, {
						filter: query.reviews,
						artistId,
						page: query.page,
					});
		const rows: (ClientPost | ClientReview)[] = found.rows;
		const projects = new Map(
			(
				await this.projects.findManyFor(
					tenant,
					membership,
					rows.map(({ projectId }) => projectId),
				)
			).map((project) => [project.id, project]),
		);
		const names = new Map(
			(
				await this.clients.findMany(
					tenant,
					[...projects.values()].map(({ clientId }) => clientId),
				)
			).map((client) => [client.id, client.name]),
		);
		const artistNames = new Map(artists.map(({ id, name }) => [id, name]));
		const projectOf = (projectId: string): ProjectRef => {
			const project = projects.get(projectId);
			return project
				? {
						id: project.id,
						clientName: names.get(project.clientId) ?? null,
						piece: excerpt(project.brief, ALERT_EXCERPT_LENGTH),
						artistName: project.artistId
							? (artistNames.get(project.artistId) ?? null)
							: null,
					}
				: null;
		};

		const posts =
			query.view === "posts"
				? await this.postRows(tenant, found.rows as ClientPost[], projectOf)
				: [];
		const reviews =
			query.view === "reviews"
				? (found.rows as ClientReview[]).map((review) =>
						reviewRow(review, tenant.timezone, projectOf(review.projectId)),
					)
				: [];

		return ctx.inertia.render("reviews/index", {
			view: query.view,
			postFilter: query.posts,
			reviewFilter: query.reviews,
			artistId,
			// The filter is offered with two or more artists (owners only).
			artists:
				owner && artists.length > 1
					? artists.map(({ id, name }) => ({ id, name }))
					: [],
			waitingCount: waiting,
			posts,
			reviews,
			page: {
				current: found.page,
				last: found.lastPage,
				total: found.total,
			},
			reportReasons: REPORT_REASONS.map((value) => ({
				value,
				label: REPORT_LABELS[value],
			})),
			limits: {
				reply: MAX_REPLY_LENGTH,
				reportNote: MAX_REPORT_NOTE_LENGTH,
			},
		});
	}

	async approve(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		return this.act(ctx, async () => {
			const { published } = await this.reviews.approve(
				tenant,
				membership,
				ctx.params.id,
			);
			return published ? STUDIO_DONE.approvedShown : STUDIO_DONE.approvedKept;
		});
	}

	async decline(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		return this.act(ctx, async () => {
			await this.reviews.decline(tenant, membership, ctx.params.id);
			return STUDIO_DONE.declined;
		});
	}

	async unpublish(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		return this.act(ctx, async () => {
			await this.reviews.unpublish(tenant, membership, ctx.params.id);
			return STUDIO_DONE.unpublished;
		});
	}

	async reply(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		return this.act(ctx, async () => {
			const { reply } = await ctx.request.validateUsing(replyValidator);
			const { created } = await this.reviews.reply(
				tenant,
				membership,
				ctx.params.id,
				reply,
			);
			return created ? STUDIO_DONE.replyPosted : STUDIO_DONE.replySaved;
		});
	}

	async deleteReply(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		return this.act(ctx, async () => {
			await this.reviews.deleteReply(tenant, membership, ctx.params.id);
			return STUDIO_DONE.replyDeleted;
		});
	}

	async report(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		return this.act(ctx, async () => {
			const { reason, note } = await ctx.request.validateUsing(reportValidator);
			await this.reviews.report(tenant, membership, ctx.params.id, {
				reason,
				note: note ? note : null,
			});
			return STUDIO_DONE.reported;
		});
	}

	/**
	 * Runs one write and goes back to the page it came from (the form's
	 * `back`, checked by reviewsBack): its toast, or the refusal's words. A
	 * refusal happens before anything is written; a public copy that can't
	 * be deleted leaves the post as it was. Validation errors and 404s are
	 * thrown as usual.
	 */
	private async act(ctx: HttpContext, work: () => Promise<string>) {
		const { tenant } = tenantContext(ctx);
		const back = reviewsBack(ctx.request.input("back"), tenant.slug);
		try {
			ctx.session.flash("success", await work());
		} catch (error) {
			if (error instanceof StudioReviewRuleError) {
				ctx.session.flash("error", STUDIO_RULE_MESSAGES[error.reason]);
			} else if (error instanceof ImageDeleteError) {
				ctx.session.flash("error", STUDIO_DONE.removeFailed);
			} else {
				throw error;
			}
		}
		return ctx.response.redirect().toPath(back);
	}

	/** The page's posts with their photos and videos, through 5-minute signed URLs (private until published). */
	private async postRows(
		tenant: Tenant,
		posts: ClientPost[],
		projectOf: (id: string) => ProjectRef,
	) {
		const media = await this.reviews.mediaFor(
			tenant,
			posts.map(({ id }) => id),
		);
		return Promise.all(
			posts.map(async (post) => {
				const items = media.get(post.id) ?? [];
				const shown = await Promise.all(
					items.map((item) => this.mediaRow(tenant, item)),
				);
				const processing = items.some(
					(item) => item.kind === "video" && item.videoState === "processing",
				);
				const takenDown = post.takenDownAt
					? takedownText(post.takedownReason)
					: null;
				return {
					id: post.id,
					status: post.status,
					statusText: postStatusText(post),
					takenDown,
					published: post.publishedAt !== null,
					dateText: dayText(
						(post.status === "waiting" ? post.waitingSince : post.decidedAt) ??
							post.createdAt,
						tenant.timezone,
					),
					edited: post.status === "waiting" && post.waitingRound > 1,
					shownName: post.shownName,
					caption: post.caption,
					styles: knownStyles(post.styles).map(({ name }) => name),
					placement: post.placement,
					consentText: consentText(post),
					project: projectOf(post.projectId),
					media: shown,
					canApprove:
						!takenDown &&
						post.status === "waiting" &&
						!processing &&
						items.length > 0,
					approveNote:
						!takenDown && post.status === "waiting" && processing
							? STUDIO_RULE_MESSAGES.processing
							: null,
					canDecline: !takenDown && post.status === "waiting",
					canUnpublish: !takenDown && post.status === "approved",
				};
			}),
		);
	}

	private async mediaRow(tenant: Tenant, item: ClientPostMedia) {
		if (item.kind === "photo") {
			return {
				id: item.id,
				kind: "photo" as const,
				state: "ready" as const,
				thumbUrl: item.imageKey
					? await this.images.urlFor(
							PHOTO_PURPOSE,
							item.imageKey,
							tenant,
							THUMBNAIL_WIDTH,
						)
					: null,
				openUrl: item.imageKey
					? await this.images.url(PHOTO_PURPOSE, item.imageKey, tenant)
					: null,
			};
		}
		const ready = item.videoState === "ready" && item.imageKey !== null;
		const sources = ready
			? await this.videos.sources(tenant, item.videoKeys ?? [], VIDEO_PURPOSE)
			: [];
		return {
			id: item.id,
			kind: "video" as const,
			state: (ready
				? "ready"
				: item.videoState === "failed"
					? "failed"
					: "processing") as "ready" | "failed" | "processing",
			thumbUrl:
				ready && item.imageKey
					? await this.images.urlFor(
							VIDEO_PURPOSE,
							item.imageKey,
							tenant,
							THUMBNAIL_WIDTH,
						)
					: null,
			openUrl: sources.at(-1)?.url ?? null,
		};
	}
}

/** The project a row belongs to, as the page links it. */
type ProjectRef = {
	id: string;
	clientName: string | null;
	piece: string;
	artistName: string | null;
} | null;

/** A review as the page shows it: the client's words as written, the reply, the report and any takedown. */
function reviewRow(
	review: ClientReview,
	timezone: string,
	project: ProjectRef,
) {
	const takenDown = review.takenDownAt
		? takedownText(review.takedownReason)
		: null;
	const openReport =
		review.reportedAt !== null && review.reportResolvedAt === null;
	return {
		id: review.id,
		rating: review.rating,
		ratingText: ratingText(review.rating),
		body: review.body,
		shownName: review.shownName,
		dateText: dayText(review.createdAt, timezone),
		consentText: consentText(review),
		project,
		takenDown,
		reply:
			review.reply !== null
				? {
						text: review.reply,
						dateText: review.repliedAt
							? dayText(review.repliedAt, timezone)
							: "",
						takenDown: review.replyTakenDownAt
							? takedownText(review.replyTakedownReason)
							: null,
					}
				: null,
		canReply: review.replyTakenDownAt === null,
		report: review.reportedAt
			? {
					reasonText:
						REPORT_LABELS[review.reportReason as keyof typeof REPORT_LABELS] ??
						"",
					note: review.reportNote,
					dateText: dayText(review.reportedAt, timezone),
					open: openReport,
				}
			: null,
		canReport: takenDown === null && !openReport,
	};
}
