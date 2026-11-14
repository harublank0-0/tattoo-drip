import { inject } from "@adonisjs/core";
import type { MultipartFile } from "@adonisjs/core/bodyparser";
import type { TransactionClientContract } from "@adonisjs/lucid/types/database";
import { DateTime } from "luxon";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ImageService from "#modules/media/services/image_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import VideoService, {
	type SignedUpload,
} from "#modules/media/services/video_service";
import {
	STUCK_AFTER_MINUTES,
	VIDEO_GAVE_UP,
	VIDEO_STUCK,
	type VideoType,
} from "#modules/media/video";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ProjectService from "#modules/projects/services/project_service";
import type { ClientVideoUpload } from "#modules/reviews/client_video_uploads";
import {
	ClientVideoUploadError,
	PostFullError,
	PostLimitError,
	PostNeedsPhotoError,
	ReviewLockedError,
	ReviewPageNotFoundError,
	ReviewTakenDownError,
} from "#modules/reviews/errors";
import FreshInkAlertJob from "#modules/reviews/jobs/fresh_ink_alert_job";
import ProcessClientPostVideoJob from "#modules/reviews/jobs/process_client_post_video_job";
import ClientPost from "#modules/reviews/models/client_post";
import ClientPostMedia from "#modules/reviews/models/client_post_media";
import ClientVideoReservation from "#modules/reviews/models/client_video_reservation";
import type { ReviewContext } from "#modules/reviews/review_context";
import {
	leadFirst,
	MAX_POST_MEDIA,
	MAX_POSTS_PER_PROJECT,
	orderWithout,
	postContentEditable,
} from "#modules/reviews/rules";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import PostPublicationService from "#modules/reviews/services/post_publication_service";
import type Tenant from "#modules/tenancy/models/tenant";
import {
	afterCommit,
	afterRollback,
	withDbContext,
	withTransaction,
} from "#services/db_context";
import { isUniqueViolation } from "#services/db_errors";
import { dispatchInTransaction } from "#services/queue";

type TenantRef = Pick<Tenant, "id">;

export const PHOTO_PURPOSE = "client_post_photo";
export const VIDEO_PURPOSE = "client_post_video";

/** What the client's submit says about the post (the validator's `post`). */
export type PostInput = {
	caption?: string | null;
	styles: string[];
	placement?: string | null;
	order?: string[];
};

/** The shown name and the consents, which the review and the post share. */
export type SharedChoices = {
	shownName: string;
	consentStudioPage: boolean;
	consentDiscover: boolean;
};

/** Who submitted, for disputes only (#modules/reviews/submitters). */
export type Submitter = { digest: string; at: DateTime };

/** Why the client can't start a new post: the last one was taken down, or the project had its posts. */
export type PostBlock = "taken_down" | "post_limit";

/** How long a signed, unfinished video upload holds a place: the upload token's hour. */
export const RESERVATION_MINUTES = 60;

/** What the worker did with a video (processVideo). */
export type VideoRun = "ready" | "failed" | "skipped";

/** Thrown when the post or the item a request names isn't there (the API's 404). */
export class PostMediaNotFoundError extends Error {
	constructor() {
		super("No such photo or video on this post");
	}
}

/**
 * Fresh ink posts (Reviews and Fresh ink, rulings 5 and 7): one live post
 * per project, its photos and videos in `client_post_media`, the angles
 * model (a lead photo and up to seven more; a video never leads). The
 * client builds it through the review link: each photo or video is added
 * on its own (a draft post is made with the first), then the submit sets
 * the caption, styles, placement and order and hands it to the studio
 * (`submittedAt`). Photos go through ImageService (`client_post_photo`),
 * videos through the work videos' pipeline unchanged (VideoService with the
 * `client_post_video` purpose, ProcessClientPostVideoJob on the video
 * queue).
 *
 * Every write runs under the project's row lock first (the order every
 * project write takes), then the post's, then its media rows'; the worker's
 * write of a video's outcome locks only that media row, so the two never
 * wait for each other in a cycle.
 */
@inject()
export default class ClientPostService {
	constructor(
		private images: ImageService,
		private videos: VideoService,
		private projects: ProjectService,
		private publication: PostPublicationService,
	) {}

	/**
	 * Locks the link's live project (ProjectService.lockLive), the first lock
	 * of every review page write, as of every project write; a project
	 * deleted meanwhile is the dead link.
	 */
	async lockProject(
		trx: TransactionClientContract,
		ctx: ReviewContext,
	): Promise<void> {
		const live = await this.projects.lockLive(trx, ctx.tenant, ctx.project.id);
		if (!live) throw new ReviewPageNotFoundError();
	}

	/** The project's live post, or null. */
	async find(tenant: TenantRef, projectId: string): Promise<ClientPost | null> {
		return ClientPost.query()
			.where("tenant_id", tenant.id)
			.where("project_id", projectId)
			.first();
	}

	/**
	 * Why a new post can't be started for the project now, or null (finding
	 * 1): its latest post, deleted or not, was taken down by TattooDrip (until
	 * an operator restores it), or it already had MAX_POSTS_PER_PROJECT posts,
	 * deleted ones included (a declined post may be deleted and posted again
	 * once). Only asked when there is no live post.
	 */
	async newPostBlock(
		tenant: TenantRef,
		projectId: string,
	): Promise<PostBlock | null> {
		const rows = await ClientPost.withTrashed()
			.where("tenant_id", tenant.id)
			.where("project_id", projectId)
			.orderBy("created_at", "desc")
			.orderBy("id", "desc");
		if (rows[0]?.takenDownAt) return "taken_down";
		return rows.length >= MAX_POSTS_PER_PROJECT ? "post_limit" : null;
	}

	/** The tenant's live post with this id, or null (the local upload route's check). */
	async findById(tenant: TenantRef, id: string): Promise<ClientPost | null> {
		return ClientPost.query()
			.where("tenant_id", tenant.id)
			.where("id", id)
			.first();
	}

	/** A post's media in their order, the lead first. */
	async mediaOf(
		tenant: TenantRef,
		post: Pick<ClientPost, "id">,
		trx?: TransactionClientContract,
	): Promise<ClientPostMedia[]> {
		const query = trx
			? ClientPostMedia.query({ client: trx }).forUpdate()
			: ClientPostMedia.query();
		return query
			.where("tenant_id", tenant.id)
			.where("post_id", post.id)
			.orderBy("position", "asc");
	}

	/**
	 * Adds a photo to the project's post as its last item, making a draft
	 * post first if there is none. The photo is stored first (ImageService:
	 * the format sniff, the size limit, the metadata strip, the copies) and
	 * deleted again if the transaction rolls back. Refuses a ninth item
	 * (PostFullError) and a post whose content the client may no longer
	 * change (ReviewLockedError). Changing an approved post's content puts it
	 * back in the studio's queue.
	 */
	async addPhoto(
		ctx: ReviewContext,
		file: Pick<MultipartFile, "tmpPath">,
		shared: SharedChoices,
	): Promise<void> {
		await this.assertRoom(ctx, "photo");
		const { tenant } = ctx;
		await withTransaction(async (trx) => {
			const stored = await this.images.store(file, {
				tenant,
				purpose: PHOTO_PURPOSE,
			});
			afterRollback(() => this.images.delete(PHOTO_PURPOSE, stored.key));
			await this.lockProject(trx, ctx);
			const post = await this.draftOrPost(trx, ctx, shared);
			if (!postContentEditable(post)) throw new ReviewLockedError();
			const media = await this.mediaOf(tenant, post, trx);
			if (media.length >= MAX_POST_MEDIA) throw new PostFullError();
			await ClientPostMedia.create(
				{
					tenantId: tenant.id,
					postId: post.id,
					kind: "photo",
					position: media.length,
					imageKey: stored.key,
					width: stored.width,
					height: stored.height,
					alt: null,
				},
				{ client: trx },
			);
			await this.contentChanged(trx, tenant, post, media);
		});
	}

	/**
	 * Before a video's upload is signed: the post must exist with a photo to
	 * lead it (PostNeedsPhotoError), be the client's to change
	 * (ReviewLockedError) and have room (PostFullError). Returns the post.
	 */
	async checkVideoRoom(ctx: ReviewContext): Promise<ClientPost> {
		const post = await this.assertRoom(ctx, "video");
		if (!post) throw new PostNeedsPhotoError();
		return post;
	}

	/**
	 * Signs one video upload for the post: a private staging key, and on R2 a
	 * presigned PUT bound to the type and exact length (VideoService); null
	 * for `upload` on the local disk, where the caller points the browser at
	 * the API's own staging route.
	 */
	async signVideo(
		ctx: ReviewContext,
		{ type, size }: { type: VideoType; size: number },
	): Promise<{ post: ClientPost; key: string; upload: SignedUpload | null }> {
		await this.checkVideoRoom(ctx);
		const { tenant } = ctx;
		const key = this.videos.stagingKey(tenant);
		// Finding 7: under the locks, the signs outstanding (reservations not
		// expired) and the items may never exceed the post's places, so a
		// script can't stage more uploads than the post could ever take.
		const post = await withTransaction(async (trx) => {
			await this.lockProject(trx, ctx);
			const live = await this.livePost(trx, ctx);
			if (!live) throw new PostNeedsPhotoError();
			if (!postContentEditable(live)) throw new ReviewLockedError();
			const now = DateTime.now();
			await ClientVideoReservation.query({ client: trx })
				.where("tenant_id", tenant.id)
				.where("post_id", live.id)
				.where("expires_at", "<=", now.toJSDate())
				.delete();
			const media = await this.mediaOf(tenant, live, trx);
			if (!media.some((item) => item.kind === "photo")) {
				throw new PostNeedsPhotoError();
			}
			const held = await ClientVideoReservation.query({ client: trx })
				.where("tenant_id", tenant.id)
				.where("post_id", live.id);
			if (media.length + held.length >= MAX_POST_MEDIA) {
				throw new PostFullError();
			}
			await ClientVideoReservation.create(
				{
					tenantId: tenant.id,
					postId: live.id,
					stagingKey: key,
					createdAt: now,
					expiresAt: now.plus({ minutes: RESERVATION_MINUTES }),
				},
				{ client: trx },
			);
			return live;
		});
		const upload = await this.videos.signUpload(tenant, key, { type, size });
		return { post, key, upload };
	}

	/**
	 * The browser uploaded a video (`upload`, from the sign step's token):
	 * the staged file must be there at exactly the signed length; then, under
	 * the locks, the same checks as checkVideoRoom, and the item is added
	 * `processing` as the post's last, with ProcessClientPostVideoJob queued
	 * in the same transaction. An upload finishes once.
	 */
	async addVideo(ctx: ReviewContext, upload: ClientVideoUpload): Promise<void> {
		const { tenant } = ctx;
		if (upload.tenantId !== tenant.id) {
			throw new Error("The video upload was signed for another studio");
		}
		const size = await this.videos.stagedSize(tenant, upload.key);
		if (size === null) {
			throw new ClientVideoUploadError(
				"The video didn't finish uploading. Choose it again.",
			);
		}
		if (size !== upload.size) throw new ClientVideoUploadError();
		try {
			await withTransaction(async (trx) => {
				await this.lockProject(trx, ctx);
				const post = await this.livePost(trx, ctx);
				if (!post || post.id !== upload.postId) {
					throw new ClientVideoUploadError();
				}
				if (!postContentEditable(post)) throw new ReviewLockedError();
				const media = await this.mediaOf(tenant, post, trx);
				if (media.length >= MAX_POST_MEDIA) throw new PostFullError();
				if (!media.some((item) => item.kind === "photo")) {
					throw new PostNeedsPhotoError();
				}
				const used = await ClientPostMedia.query({ client: trx })
					.where("tenant_id", tenant.id)
					.where("video_staging_key", upload.key)
					.first();
				if (used) {
					throw new ClientVideoUploadError("This video was added already.");
				}
				// Its place is now the item's: the sign's reservation goes.
				await ClientVideoReservation.query({ client: trx })
					.where("tenant_id", tenant.id)
					.where("staging_key", upload.key)
					.delete();
				const video = await ClientPostMedia.create(
					{
						tenantId: tenant.id,
						postId: post.id,
						kind: "video",
						position: media.length,
						videoState: "processing",
						videoStagingKey: upload.key,
						imageKey: null,
						width: null,
						height: null,
						alt: null,
					},
					{ client: trx },
				);
				await dispatchInTransaction(
					ProcessClientPostVideoJob.dispatch({
						tenantId: tenant.id,
						mediaId: video.id,
					}),
					trx,
				);
				await this.contentChanged(trx, tenant, post, media);
			});
		} catch (error) {
			if (isUniqueViolation(error, "client_post_media_video_staging_key")) {
				throw new ClientVideoUploadError("This video was added already.");
			}
			throw error;
		}
	}

	/**
	 * Removes one photo or video: its files first (ImageService.deleteOrThrow
	 * or VideoService.deleteOrThrow; a file that can't be deleted keeps the
	 * row and fails the request, so a photo is never reported gone while its
	 * URL still answers), then its row, then the rest close up in one UPDATE
	 * (the deferrable unique place), the first photo leading. A video still
	 * processing has no files yet: its staged upload is deleted after the
	 * commit, and the worker then finds no row. The last photo can't go while
	 * a video stays (PostNeedsPhotoError).
	 */
	async removeMedia(ctx: ReviewContext, mediaId: string): Promise<void> {
		const { tenant } = ctx;
		await withTransaction(async (trx) => {
			await this.lockProject(trx, ctx);
			const post = await this.livePost(trx, ctx);
			if (!post) throw new PostMediaNotFoundError();
			const media = await this.mediaOf(tenant, post, trx);
			const target = media.find((item) => item.id === mediaId);
			if (!target) throw new PostMediaNotFoundError();
			if (!postContentEditable(post)) throw new ReviewLockedError();
			const order = orderWithout(media, mediaId);
			if (!order) throw new PostNeedsPhotoError();
			// Slice 2: an approved post goes back to the studio's queue; its
			// public copies go first, the removed item's included.
			if (post.publishedAt) {
				await this.publication.withdraw(tenant, post, media);
			}
			await this.deleteFiles(tenant, [target]);
			await target.delete();
			await reposition(trx, tenant, post, order);
			await this.contentChanged(trx, tenant, post, media);
		});
	}

	/**
	 * "Make photo 3 the main photo" (finding 13): the post's order alone,
	 * every item once and a photo first, in one UPDATE; no other field, no
	 * consent and no bot challenge (rate-limited as a write). A change of an
	 * approved post puts it back in the studio's queue, like any content.
	 */
	async reorder(ctx: ReviewContext, order: readonly string[]): Promise<void> {
		const { tenant } = ctx;
		await withTransaction(async (trx) => {
			await this.lockProject(trx, ctx);
			const post = await this.livePost(trx, ctx);
			if (!post) throw new PostMediaNotFoundError();
			if (!postContentEditable(post)) throw new ReviewLockedError();
			const media = await this.mediaOf(tenant, post, trx);
			const asked = ordered(media, order);
			if (asked[0].kind !== "photo") throw new PostNeedsPhotoError();
			if (asked.every((item, index) => item.id === media[index].id)) return;
			await reposition(trx, tenant, post, asked);
			await this.contentChanged(trx, tenant, post, media);
		});
	}

	/**
	 * The submit's part for the post (ReviewPageService.submit, inside its
	 * transaction, under the project's lock): the caption, styles, placement
	 * and, when given, the order (a permutation of the post's items with a
	 * photo first). The post must exist with at least one item. A draft is
	 * handed to the studio (`submittedAt`, status `waiting`); a change of an
	 * approved post's content puts it back in the studio's queue. A post
	 * whose content is locked refuses (ReviewLockedError).
	 */
	async save(
		trx: TransactionClientContract,
		ctx: ReviewContext,
		input: PostInput,
		submitter?: Submitter,
	): Promise<"needs_media" | "saved"> {
		const { tenant } = ctx;
		const post = await this.livePost(trx, ctx);
		if (!post) return "needs_media";
		const media = await this.mediaOf(tenant, post, trx);
		if (media.length === 0) return "needs_media";
		if (!postContentEditable(post)) throw new ReviewLockedError();

		let order = media;
		if (input.order) {
			order = ordered(media, input.order);
			if (order[0].kind !== "photo") throw new PostNeedsPhotoError();
		}
		const caption = blankAsNull(input.caption);
		const placement = blankAsNull(input.placement);
		const reordered = order.some((item, index) => item.id !== media[index].id);
		const changed =
			reordered ||
			caption !== post.caption ||
			placement !== post.placement ||
			input.styles.join(",") !== post.styles.join(",");

		if (reordered) await reposition(trx, tenant, post, order);
		post.caption = caption;
		post.placement = placement;
		post.styles = [...input.styles];
		if (post.submittedAt === null) {
			post.submittedAt = DateTime.now();
			await this.enterQueue(trx, tenant, post);
		} else if (changed && post.status === "approved") {
			await this.backToQueue(trx, tenant, post, media);
		}
		if (submitter) {
			post.submitterDigest = submitter.digest;
			post.submitterRecordedAt = submitter.at;
		}
		await post.save();
		return "saved";
	}

	/**
	 * The shown name and the consents on the project's live post, if any
	 * (ruling 8: always the client's to change). Slice 2: the public copies
	 * follow at once (PostPublicationService.sync): a withdrawn last surface
	 * deletes them, a first surface on an approved post makes them. Never a
	 * deleted post (finding 6): its scrubbed name stays scrubbed.
	 */
	async applyShared(
		trx: TransactionClientContract,
		ctx: ReviewContext,
		shared: SharedChoices,
	): Promise<void> {
		const post = await this.livePost(trx, ctx);
		if (!post) return;
		post.shownName = shared.shownName;
		post.consentStudioPage = shared.consentStudioPage;
		post.consentDiscover = shared.consentDiscover;
		post.updatedAt = DateTime.now();
		await this.publication.sync(ctx.tenant, post);
	}

	/**
	 * The client deletes their post (ruling 2, finding 22): every item's
	 * files first, then the items and the reservations, then the post is
	 * scrubbed (no caption, placement, styles or name) and soft-deleted, so
	 * only its ids, dates, decision and any takedown record stay. Staged
	 * uploads of videos still processing go after the commit. Nothing to
	 * delete is no error.
	 */
	async delete(ctx: ReviewContext): Promise<void> {
		await withTransaction(async (trx) => {
			await this.lockProject(trx, ctx);
			const post = await this.livePost(trx, ctx);
			if (post) await this.erase(trx, ctx.tenant, post);
		});
	}

	/**
	 * Every live post of the client (the privacy deletion, finding 8):
	 * erased as the client's own delete erases one. In the caller's
	 * transaction.
	 */
	async eraseForClient(
		trx: TransactionClientContract,
		tenant: TenantRef,
		clientId: string,
	): Promise<void> {
		const posts = await ClientPost.query({ client: trx })
			.where("tenant_id", tenant.id)
			.where("client_id", clientId)
			.forUpdate();
		for (const post of posts) await this.erase(trx, tenant, post);
		await ClientPost.withTrashed()
			.where("tenant_id", tenant.id)
			.where("client_id", clientId)
			.update({
				shown_name: "",
				caption: null,
				placement: null,
				styles: [],
				consent_studio_page: false,
				consent_discover: false,
				submitter_digest: null,
				submitter_recorded_at: null,
			});
	}

	/** A post's files, items and reservations gone, the post scrubbed and soft-deleted. */
	private async erase(
		trx: TransactionClientContract,
		tenant: TenantRef,
		post: ClientPost,
	): Promise<void> {
		const media = await this.mediaOf(tenant, post, trx);
		// The public copies first (slice 2), then the private files.
		if (post.publishedAt) {
			await this.publication.withdraw(tenant, post, media);
		}
		await this.deleteFiles(tenant, media);
		await ClientPostMedia.query({ client: trx })
			.where("tenant_id", tenant.id)
			.where("post_id", post.id)
			.delete();
		await ClientVideoReservation.query({ client: trx })
			.where("tenant_id", tenant.id)
			.where("post_id", post.id)
			.delete();
		post.caption = null;
		post.placement = null;
		post.styles = [];
		post.shownName = "";
		post.consentStudioPage = false;
		post.consentDiscover = false;
		await post.softDelete(trx);
	}

	/**
	 * The stuck-video sweep for client videos (FailStuckClientVideoJob,
	 * finding 4): a video still `processing` STUCK_AFTER_MINUTES after it was
	 * added is failed with VIDEO_STUCK under its row's lock, and its staged
	 * upload deleted after the commit. True when it did; a video that
	 * finished, was removed or is younger is left as it is.
	 */
	async failStuckVideo(tenant: TenantRef, mediaId: string): Promise<boolean> {
		return withTransaction(async (trx) => {
			const row = await ClientPostMedia.query({ client: trx })
				.where("tenant_id", tenant.id)
				.where("id", mediaId)
				.forUpdate()
				.first();
			if (!row) return false;
			const { rows } = await trx.rawQuery(
				`update client_post_media set video_state = 'failed', video_failure = ?, updated_at = now()
				where tenant_id = ? and id = ? and kind = 'video' and video_state = 'processing'
					and created_at <= now() - make_interval(mins => ?)
				returning video_staging_key`,
				[VIDEO_STUCK, tenant.id, mediaId, STUCK_AFTER_MINUTES],
			);
			const staged = (rows as { video_staging_key: string }[])[0];
			if (!staged) return false;
			afterCommit(() =>
				this.videos.deleteStaged(tenant, staged.video_staging_key),
			);
			return true;
		});
	}

	/**
	 * The worker's part (ProcessClientPostVideoJob), the work videos' model
	 * (WorkPhotoService.processVideo): safe to run twice or after the item is
	 * gone; never inside a transaction, and none is open while ffmpeg runs.
	 * One short transaction reads the item (only a video still `processing`
	 * is worked on), VideoService.process makes the renditions and the poster
	 * under `client_post_video`, one more writes the outcome if the item is
	 * still processing that upload. Files made for an item removed meanwhile
	 * are deleted again; the staged upload goes once processed or refused.
	 */
	async processVideo(
		tenant: TenantRef,
		mediaId: string,
		signal?: AbortSignal,
	): Promise<VideoRun> {
		const staged = await withDbContext({ tenantId: tenant.id }, () =>
			this.videoToProcess(tenant, mediaId),
		);
		if (!staged) return "skipped";
		const outcome = await this.videos.process(
			tenant,
			staged,
			signal,
			VIDEO_PURPOSE,
		);
		if (outcome.kind === "refused") {
			const settled = await withDbContext({ tenantId: tenant.id }, () =>
				this.settleVideo(tenant, mediaId, staged, {
					video_state: "failed",
					video_failure: outcome.reason,
				}),
			);
			await this.videos.deleteStaged(tenant, staged);
			return settled ? "failed" : "skipped";
		}
		let kept = false;
		try {
			kept = await withDbContext({ tenantId: tenant.id }, () =>
				this.settleVideo(tenant, mediaId, staged, {
					video_state: "ready",
					image_key: outcome.posterKey,
					width: outcome.width,
					height: outcome.height,
					video_duration_ms: outcome.durationMs,
					video_keys: outcome.keys,
				}),
			);
		} finally {
			if (!kept) {
				await this.videos.removeFiles(
					outcome.posterKey,
					outcome.keys,
					VIDEO_PURPOSE,
				);
			}
		}
		await this.videos.deleteStaged(tenant, staged);
		return kept ? "ready" : "skipped";
	}

	/** A video whose job used up its retries: `failed`, asking for a new upload, if still processing. */
	async giveUpVideo(tenant: TenantRef, mediaId: string): Promise<void> {
		const staged = await withDbContext({ tenantId: tenant.id }, () =>
			this.videoToProcess(tenant, mediaId),
		);
		if (!staged) return;
		await withDbContext({ tenantId: tenant.id }, () =>
			this.settleVideo(tenant, mediaId, staged, {
				video_state: "failed",
				video_failure: VIDEO_GAVE_UP,
			}),
		);
		await this.videos.deleteStaged(tenant, staged);
	}

	/**
	 * A change of the post's content (ruling 7): an approved post needs the
	 * studio's approval again (`backToQueue`), and any change moves
	 * `updated_at`. `media` is what the post held before the change.
	 */
	private async contentChanged(
		trx: TransactionClientContract,
		tenant: TenantRef,
		post: ClientPost,
		media: readonly ClientPostMedia[],
	): Promise<void> {
		if (post.status === "approved") {
			await this.backToQueue(trx, tenant, post, media);
		}
		post.updatedAt = DateTime.now();
		await post.save();
	}

	/**
	 * The submit hands a draft to the studio: its first round in the queue,
	 * and the staff alert (FreshInkAlertJob, in this transaction, so it
	 * exists exactly when the submit does). Not saved here.
	 */
	private async enterQueue(
		trx: TransactionClientContract,
		tenant: TenantRef,
		post: ClientPost,
	): Promise<void> {
		post.waitingRound = 1;
		post.waitingSince = DateTime.now();
		await queueAlert(trx, tenant, post);
	}

	/**
	 * A client's change of an approved post sends it back to the studio
	 * (ruling 7): its public copies are deleted first (they must not stay
	 * while it waits), the decision is cleared, and a new round alerts the
	 * staff again. Not saved here.
	 */
	private async backToQueue(
		trx: TransactionClientContract,
		tenant: TenantRef,
		post: ClientPost,
		media: readonly ClientPostMedia[],
	): Promise<void> {
		if (post.publishedAt) {
			await this.publication.withdraw(tenant, post, media);
		}
		post.status = "waiting";
		post.decidedAt = null;
		post.decidedBy = null;
		post.waitingRound += 1;
		post.waitingSince = DateTime.now();
		await queueAlert(trx, tenant, post);
	}

	/** The project's live post under its lock, or null. */
	private livePost(
		trx: TransactionClientContract,
		ctx: ReviewContext,
	): Promise<ClientPost | null> {
		return ClientPost.query({ client: trx })
			.where("tenant_id", ctx.tenant.id)
			.where("project_id", ctx.project.id)
			.forUpdate()
			.first();
	}

	/** The live post, or a new draft with the shared choices. */
	private async draftOrPost(
		trx: TransactionClientContract,
		ctx: ReviewContext,
		shared: SharedChoices,
	): Promise<ClientPost> {
		const post = await this.livePost(trx, ctx);
		if (post) return post;
		await this.assertCanStart(ctx);
		return ClientPost.create(
			{
				tenantId: ctx.tenant.id,
				projectId: ctx.project.id,
				clientId: ctx.client.id,
				artistId: ctx.artistId,
				caption: null,
				styles: [],
				placement: null,
				status: "waiting",
				submittedAt: null,
				decidedAt: null,
				decidedBy: null,
				shownName: shared.shownName,
				consentStudioPage: shared.consentStudioPage,
				consentDiscover: shared.consentDiscover,
			},
			{ client: trx },
		);
	}

	/**
	 * The unlocked check before a costly step (decoding a photo, signing an
	 * upload), repeated under the locks: room for one more item, content the
	 * client may change, and for a video a photo to lead it.
	 */
	private async assertRoom(
		ctx: ReviewContext,
		kind: "photo" | "video",
	): Promise<ClientPost | null> {
		const post = await this.find(ctx.tenant, ctx.project.id);
		if (!post) {
			if (kind === "video") throw new PostNeedsPhotoError();
			await this.assertCanStart(ctx);
			return null;
		}
		if (!postContentEditable(post)) throw new ReviewLockedError();
		const media = await this.mediaOf(ctx.tenant, post);
		if (media.length >= MAX_POST_MEDIA) throw new PostFullError();
		if (kind === "video" && !media.some((item) => item.kind === "photo")) {
			throw new PostNeedsPhotoError();
		}
		return post;
	}

	/** Refuses a new post the project may not have (newPostBlock). */
	private async assertCanStart(ctx: ReviewContext): Promise<void> {
		const block = await this.newPostBlock(ctx.tenant, ctx.project.id);
		if (block === "taken_down") throw new ReviewTakenDownError();
		if (block === "post_limit") throw new PostLimitError();
	}

	/** Deletes these items' files, or throws ImageDeleteError (then nothing is deleted from the database). */
	private async deleteFiles(
		tenant: TenantRef,
		media: readonly ClientPostMedia[],
	): Promise<void> {
		for (const item of media) {
			if (item.kind === "photo") {
				if (item.imageKey) {
					await this.images.deleteOrThrow(PHOTO_PURPOSE, item.imageKey);
				}
				continue;
			}
			if (item.videoState === "ready") {
				await this.videos.deleteOrThrow(
					tenant,
					item.imageKey,
					item.videoKeys,
					VIDEO_PURPOSE,
				);
			} else if (item.videoState === "processing" && item.videoStagingKey) {
				const staged = item.videoStagingKey;
				afterCommit(() => this.videos.deleteStaged(tenant, staged));
			}
		}
	}

	/** The staged upload of a video item still processing, or null. */
	private async videoToProcess(
		tenant: TenantRef,
		mediaId: string,
	): Promise<string | null> {
		const row = await ClientPostMedia.query()
			.where("tenant_id", tenant.id)
			.where("id", mediaId)
			.first();
		if (!row || row.kind !== "video" || row.videoState !== "processing") {
			return null;
		}
		return row.videoStagingKey;
	}

	/**
	 * Writes a video's outcome only while its item is still processing that
	 * upload: true when it did. The item is locked first, the lock a removal
	 * takes on it, so a removal that came first leaves no row here (the
	 * caller deletes what it made) and one that comes after sees the files.
	 */
	protected async settleVideo(
		tenant: TenantRef,
		mediaId: string,
		stagingKey: string,
		values: Record<string, string | number | string[]>,
	): Promise<boolean> {
		const row = await ClientPostMedia.query()
			.where("tenant_id", tenant.id)
			.where("id", mediaId)
			.forUpdate()
			.first();
		if (!row) return false;
		const changed = await ClientPostMedia.query()
			.where("tenant_id", tenant.id)
			.where("id", mediaId)
			.where("kind", "video")
			.where("video_state", "processing")
			.where("video_staging_key", stagingKey)
			.update({ ...values, updated_at: new Date() });
		return Number(changed[0] ?? 0) > 0;
	}
}

/** An `order` that isn't exactly the post's items (a stale page): the client reloads. */
export class OrderMismatchError extends Error {
	constructor() {
		super("The order doesn't name the post's photos and videos");
	}
}

/** The post's items in the order `ids` asks: every item exactly once, else OrderMismatchError (a stale page). */
function ordered(
	media: readonly ClientPostMedia[],
	ids: readonly string[],
): ClientPostMedia[] {
	const byId = new Map(media.map((item) => [item.id, item]));
	const asked = ids.map((id) => byId.get(id));
	if (
		media.length === 0 ||
		asked.length !== media.length ||
		new Set(ids).size !== ids.length ||
		asked.some((item) => item === undefined)
	) {
		throw new OrderMismatchError();
	}
	return asked as ClientPostMedia[];
}

/** Puts the items in this order, positions 0..n-1, in one UPDATE (the deferrable unique place). */
async function reposition(
	trx: TransactionClientContract,
	tenant: TenantRef,
	post: Pick<ClientPost, "id">,
	order: readonly Pick<ClientPostMedia, "id" | "kind">[],
): Promise<void> {
	const led = leadFirst(order);
	if (!led) throw new PostNeedsPhotoError();
	if (led.length === 0) return;
	const cases = led.map(() => "when ?::uuid then ?::smallint").join(" ");
	const bindings = led.flatMap((item, index) => [item.id, index]);
	await trx.rawQuery(
		`update client_post_media set position = case id ${cases} end, updated_at = now()
		where tenant_id = ? and post_id = ? and id in (${led.map(() => "?").join(", ")})`,
		[...bindings, tenant.id, post.id, ...led.map((item) => item.id)],
	);
}

/** Queues the staff alert for the post's current round (once per post per round). */
async function queueAlert(
	trx: TransactionClientContract,
	tenant: TenantRef,
	post: ClientPost,
): Promise<void> {
	await dispatchInTransaction(
		FreshInkAlertJob.dispatch({
			tenantId: tenant.id,
			postId: post.id,
			round: post.waitingRound,
		}),
		trx,
	);
}

function blankAsNull(value: string | null | undefined): string | null {
	const text = value?.trim() ?? "";
	return text === "" ? null : text;
}
