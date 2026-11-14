import { inject } from "@adonisjs/core";
import { errors as lucidErrors } from "@adonisjs/lucid";
import type { TransactionClientContract } from "@adonisjs/lucid/types/database";
import { DateTime } from "luxon";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ProjectService, {
	type Member,
} from "#modules/projects/services/project_service";
import ClientPost from "#modules/reviews/models/client_post";
import ClientPostMedia from "#modules/reviews/models/client_post_media";
import ClientReview from "#modules/reviews/models/client_review";
import type {
	PostFilter,
	ReportReason,
	ReviewFilter,
} from "#modules/reviews/rules";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import PostPublicationService from "#modules/reviews/services/post_publication_service";
import type Tenant from "#modules/tenancy/models/tenant";
import { withTransaction } from "#services/db_context";

type TenantRef = Pick<Tenant, "id">;

/** Rows per page on the Reviews page (ui.md: open-ended lists are 25 a page). */
export const REVIEWS_PAGE_SIZE = 25;

export {
	POST_FILTERS,
	type PostFilter,
	REVIEW_FILTERS,
	type ReviewFilter,
} from "#modules/reviews/rules";

/** Why the studio can't do what it asked now; the dashboard words each. */
export type StudioReviewRule =
	| "not_waiting"
	| "not_approved"
	| "processing"
	| "empty"
	| "taken_down"
	| "reply_taken_down"
	| "already_reported";

export class StudioReviewRuleError extends Error {
	constructor(readonly reason: StudioReviewRule) {
		super(`The studio can't do that now: ${reason}`);
	}
}

/** A page of rows. */
export type Paged<T> = {
	rows: T[];
	total: number;
	page: number;
	lastPage: number;
};

/**
 * The studio's side of reviews and Fresh ink (Reviews and Fresh ink, slice
 * 2): the Reviews page's lists and counts, deciding on a post (approve,
 * decline, unpublish), and the one public reply and the report to
 * TattooDrip on a review.
 *
 * Who sees what: owners every submitted post and every live review of the
 * studio's live projects; an artist only those of projects assigned to
 * their own live artist profile (ProjectService.visibleIds, the findFor
 * rule), anything else is E_ROW_NOT_FOUND (a 404). Every write re-checks
 * that under the project's row lock (ProjectService.lockFor), then locks
 * the post or the review.
 *
 * What the studio can never do (rulings 6 and 7): hide, edit or delete a
 * review, or edit a post. No method here writes a review's rating, text,
 * name or consents, or a post's photos, caption, styles, placement, name or
 * consents: each write names its own columns (the reply, the report, the
 * decision).
 */
@inject()
export default class StudioReviewService {
	constructor(
		private projects: ProjectService,
		private publication: PostPublicationService,
	) {}

	/** How many posts wait for `member` (the nav's badge): submitted, waiting, not taken down. */
	async waitingCount(tenant: TenantRef, member: Member): Promise<number> {
		const { subquery: visible } = await this.projects.visibleIds(
			tenant,
			member,
		);
		const [row] = await ClientPost.query()
			.where("tenant_id", tenant.id)
			.whereNotNull("submitted_at")
			.where("status", "waiting")
			.whereNull("taken_down_at")
			.whereIn("project_id", visible)
			.count("* as total");
		return Number(row.$extras.total);
	}

	/**
	 * A page of the posts `member` may see: waiting ones first in, first
	 * out; approved and declined (declined or unpublished) ones by their
	 * decision, newest first. Drafts are the client's own and never listed.
	 * A page past the last is the last.
	 */
	async postsPage(
		tenant: TenantRef,
		member: Member,
		query: { filter: PostFilter; artistId: string | null; page: number },
	): Promise<Paged<ClientPost>> {
		const { subquery: visible } = await this.projects.visibleIds(
			tenant,
			member,
			query.artistId,
		);
		const find = (at: number) => {
			const rows = ClientPost.query()
				.where("tenant_id", tenant.id)
				.whereNotNull("submitted_at")
				.whereIn("project_id", visible);
			if (query.filter === "waiting") {
				rows
					.where("status", "waiting")
					.orderBy("waiting_since", "asc")
					.orderBy("id", "asc");
			} else {
				rows
					.whereIn(
						"status",
						query.filter === "approved"
							? ["approved"]
							: ["declined", "unpublished"],
					)
					.orderBy("decided_at", "desc")
					.orderBy("id", "desc");
			}
			return rows.paginate(at, REVIEWS_PAGE_SIZE);
		};
		return paged(find, query.page);
	}

	/** A page of the live reviews `member` may see, newest first; `reported` only those reported to TattooDrip. */
	async reviewsPage(
		tenant: TenantRef,
		member: Member,
		query: { filter: ReviewFilter; artistId: string | null; page: number },
	): Promise<Paged<ClientReview>> {
		const { subquery: visible } = await this.projects.visibleIds(
			tenant,
			member,
			query.artistId,
		);
		const find = (at: number) => {
			const rows = ClientReview.query()
				.where("tenant_id", tenant.id)
				.whereIn("project_id", visible);
			if (query.filter === "reported") rows.whereNotNull("reported_at");
			return rows
				.orderBy("created_at", "desc")
				.orderBy("id", "desc")
				.paginate(at, REVIEWS_PAGE_SIZE);
		};
		return paged(find, query.page);
	}

	/**
	 * The live submitted posts among `ids` that `member` may see (the Alerts
	 * list's Fresh ink lines, AlertContentService). No query for [].
	 */
	async postsFor(
		tenant: TenantRef,
		member: Member,
		ids: readonly string[],
	): Promise<ClientPost[]> {
		if (ids.length === 0) return [];
		const { subquery: visible } = await this.projects.visibleIds(
			tenant,
			member,
		);
		return ClientPost.query()
			.where("tenant_id", tenant.id)
			.whereIn("id", [...ids])
			.whereNotNull("submitted_at")
			.whereIn("project_id", visible);
	}

	/** The photos and videos of these posts, by post, each in its order. One query. */
	async mediaFor(
		tenant: TenantRef,
		postIds: readonly string[],
	): Promise<Map<string, ClientPostMedia[]>> {
		const byPost = new Map<string, ClientPostMedia[]>();
		if (postIds.length === 0) return byPost;
		const rows = await ClientPostMedia.query()
			.where("tenant_id", tenant.id)
			.whereIn("post_id", [...postIds])
			.orderBy("post_id")
			.orderBy("position", "asc");
		for (const row of rows) {
			byPost.set(row.postId, [...(byPost.get(row.postId) ?? []), row]);
		}
		return byPost;
	}

	/**
	 * Approves a waiting post (ruling 7): its photos and videos are
	 * published at once when the client allowed a surface
	 * (PostPublicationService), else when they allow one. Refused while a
	 * video is still processing (`processing`), for a post with nothing in
	 * it (`empty`), one not waiting (`not_waiting`) or taken down. Returns
	 * whether it is now published.
	 */
	async approve(
		tenant: TenantRef,
		member: Member,
		postId: string,
	): Promise<{ published: boolean }> {
		return this.decide(tenant, member, postId, async (post, media) => {
			if (post.status !== "waiting") {
				throw new StudioReviewRuleError("not_waiting");
			}
			if (media.length === 0) throw new StudioReviewRuleError("empty");
			if (
				media.some(
					(item) => item.kind === "video" && item.videoState === "processing",
				)
			) {
				throw new StudioReviewRuleError("processing");
			}
			post.status = "approved";
			post.decidedAt = DateTime.now();
			post.decidedBy = member.userId;
			await this.publication.sync(tenant, post, media);
			return { published: post.publishedAt !== null };
		});
	}

	/**
	 * Declines a waiting post (ruling 7): the client's page then says only
	 * "not shown by the studio". Nothing was public, nothing is deleted.
	 */
	async decline(
		tenant: TenantRef,
		member: Member,
		postId: string,
	): Promise<void> {
		await this.decide(tenant, member, postId, async (post, media) => {
			if (post.status !== "waiting") {
				throw new StudioReviewRuleError("not_waiting");
			}
			post.status = "declined";
			post.decidedAt = DateTime.now();
			post.decidedBy = member.userId;
			await this.publication.sync(tenant, post, media);
		});
	}

	/**
	 * Takes an approved post off the studio's surfaces (ruling 7): its public
	 * copies are deleted first (ImageDeleteError when one can't be: the post
	 * stays approved), and the client's page says "not shown by the studio".
	 */
	async unpublish(
		tenant: TenantRef,
		member: Member,
		postId: string,
	): Promise<void> {
		await this.decide(tenant, member, postId, async (post, media) => {
			if (post.status !== "approved") {
				throw new StudioReviewRuleError("not_approved");
			}
			post.status = "unpublished";
			post.decidedAt = DateTime.now();
			post.decidedBy = member.userId;
			await this.publication.sync(tenant, post, media);
		});
	}

	/**
	 * Writes the studio's one public reply to a review (ruling 6), or replaces
	 * it; `replied_at` is the last change. Only the reply's columns change.
	 * Refused while TattooDrip has the reply taken down.
	 */
	async reply(
		tenant: TenantRef,
		member: Member,
		reviewId: string,
		text: string,
	): Promise<{ created: boolean }> {
		return this.onReview(tenant, member, reviewId, async (trx, review) => {
			if (review.replyTakenDownAt) {
				throw new StudioReviewRuleError("reply_taken_down");
			}
			await ClientReview.query({ client: trx })
				.where("tenant_id", tenant.id)
				.where("id", review.id)
				.update({
					reply: text,
					replied_at: new Date(),
					updated_at: new Date(),
				});
			return { created: review.reply === null };
		});
	}

	/** Deletes the studio's reply. Refused while TattooDrip has it taken down (the takedown record stays). */
	async deleteReply(
		tenant: TenantRef,
		member: Member,
		reviewId: string,
	): Promise<void> {
		await this.onReview(tenant, member, reviewId, async (trx, review) => {
			if (review.replyTakenDownAt) {
				throw new StudioReviewRuleError("reply_taken_down");
			}
			await ClientReview.query({ client: trx })
				.where("tenant_id", tenant.id)
				.where("id", review.id)
				.update({ reply: null, replied_at: null, updated_at: new Date() });
		});
	}

	/**
	 * Reports a review to TattooDrip (ruling 6) with a reason and an optional
	 * note: it stays up until TattooDrip decides (ruling 12). Refused while a
	 * report is open (`already_reported`) and once it is taken down; after
	 * TattooDrip kept it up, the studio may report it again.
	 */
	async report(
		tenant: TenantRef,
		member: Member,
		reviewId: string,
		input: { reason: ReportReason; note: string | null },
	): Promise<void> {
		await this.onReview(tenant, member, reviewId, async (trx, review) => {
			if (review.takenDownAt) throw new StudioReviewRuleError("taken_down");
			if (review.reportedAt && !review.reportResolvedAt) {
				throw new StudioReviewRuleError("already_reported");
			}
			await ClientReview.query({ client: trx })
				.where("tenant_id", tenant.id)
				.where("id", review.id)
				.update({
					reported_at: new Date(),
					report_reason: input.reason,
					report_note: input.note,
					reported_by: member.userId,
					report_resolved_at: null,
					updated_at: new Date(),
				});
		});
	}

	/**
	 * One decision on a submitted post: found for the member (else a 404),
	 * then under the project's lock (re-checked for an artist), the post's
	 * and its media's. A post TattooDrip took down takes no decision.
	 */
	private async decide<T>(
		tenant: TenantRef,
		member: Member,
		postId: string,
		fn: (post: ClientPost, media: ClientPostMedia[]) => Promise<T>,
	): Promise<T> {
		const found = await this.findPost(tenant, member, postId);
		return withTransaction(async (trx) => {
			await this.projects.lockFor(trx, tenant, member, found.projectId);
			const post = await ClientPost.query({ client: trx })
				.where("tenant_id", tenant.id)
				.where("id", found.id)
				.whereNotNull("submitted_at")
				.forUpdate()
				.first();
			if (!post) throw new lucidErrors.E_ROW_NOT_FOUND(ClientPost);
			if (post.takenDownAt) throw new StudioReviewRuleError("taken_down");
			const media = await ClientPostMedia.query({ client: trx })
				.where("tenant_id", tenant.id)
				.where("post_id", post.id)
				.orderBy("position", "asc")
				.forUpdate();
			return fn(post, media);
		});
	}

	/** One write on a live review the member may see, under the project's and the review's locks. */
	private async onReview<T>(
		tenant: TenantRef,
		member: Member,
		reviewId: string,
		fn: (trx: TransactionClientContract, review: ClientReview) => Promise<T>,
	): Promise<T> {
		const { subquery: visible } = await this.projects.visibleIds(
			tenant,
			member,
		);
		const found = await ClientReview.query()
			.where("tenant_id", tenant.id)
			.where("id", reviewId)
			.whereIn("project_id", visible)
			.firstOrFail();
		return withTransaction(async (trx) => {
			await this.projects.lockFor(trx, tenant, member, found.projectId);
			const review = await ClientReview.query({ client: trx })
				.where("tenant_id", tenant.id)
				.where("id", found.id)
				.forUpdate()
				.first();
			if (!review) throw new lucidErrors.E_ROW_NOT_FOUND(ClientReview);
			return fn(trx, review);
		});
	}

	/** A submitted post the member may see, else E_ROW_NOT_FOUND. */
	private async findPost(
		tenant: TenantRef,
		member: Member,
		postId: string,
	): Promise<ClientPost> {
		const { subquery: visible } = await this.projects.visibleIds(
			tenant,
			member,
		);
		return ClientPost.query()
			.where("tenant_id", tenant.id)
			.where("id", postId)
			.whereNotNull("submitted_at")
			.whereIn("project_id", visible)
			.firstOrFail();
	}
}

/** A paginated read, asked again for the last page when `wanted` is past it. */
async function paged<T>(
	find: (at: number) => Promise<{
		all(): T[];
		total: number;
		lastPage: number;
	}>,
	wanted: number,
): Promise<Paged<T>> {
	const page = Math.max(1, Math.floor(wanted) || 1);
	let result = await find(page);
	if (page > result.lastPage && result.total > 0) {
		result = await find(result.lastPage);
	}
	const lastPage = Math.max(1, result.lastPage);
	return {
		rows: result.all(),
		total: result.total,
		page: Math.max(1, Math.min(page, lastPage)),
		lastPage,
	};
}
