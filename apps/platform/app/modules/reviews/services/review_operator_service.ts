import { inject } from "@adonisjs/core";
import logger from "@adonisjs/core/services/logger";
import { DateTime } from "luxon";
import { excerpt } from "#modules/notifications/alerts";
import ClientPost from "#modules/reviews/models/client_post";
import ClientReview from "#modules/reviews/models/client_review";
import type { TakedownKind, TakedownReason } from "#modules/reviews/rules";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import PostPublicationService from "#modules/reviews/services/post_publication_service";
import Tenant from "#modules/tenancy/models/tenant";
import { dbClient, withDbContext } from "#services/db_context";

/** An operator command named something that isn't there; the message is for the operator. */
export class ReviewOperatorError extends Error {}

/** What the operator's report list shows of one report. */
export type OpenReport = {
	tenantId: string;
	studioSlug: string;
	studioName: string;
	reviewId: string;
	reportedAt: DateTime;
	reason: string;
	note: string | null;
	rating: number | null;
	body: string;
	shownName: string;
};

/** One review, reply or post on the operator's studio page. */
export type OperatorItem = {
	kind: TakedownKind;
	/** The review's id for a review and its reply, the post's id for a post. */
	id: string;
	/** When it was written or published. */
	at: DateTime;
	shownName: string;
	/** Null for a post. */
	rating: number | null;
	excerpt: string;
	takedown: {
		at: DateTime;
		reason: TakedownReason;
		note: string | null;
	} | null;
};

/** The SECURITY DEFINER lookup that finds an item's tenant (ids only, live tenants). */
const LOOKUPS: Record<"review" | "post", string> = {
	review: "select public.client_review_tenant(?::uuid) as id",
	post: "select public.client_post_tenant(?::uuid) as id",
};

/** Characters of a review, reply or caption the studio page shows. */
const EXCERPT = 200;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * TattooDrip's own tools for reviews and Fresh ink (ruling 12, slice 2),
 * for the operator commands (`reviews:takedown`, `reviews:restore`,
 * `reviews:dismiss`, `reviews:reports`) and the platform admin pages, never
 * a studio's or a client's request and never the worker. A request never
 * uses the owner connection: it reads as the app role in a tenant context. The
 * model of `discover:suspend`: an item's tenant comes from a SECURITY
 * DEFINER lookup that returns one id (`client_review_tenant`,
 * `client_post_tenant`), and everything is then read and written as the app
 * role inside that tenant's context, so row-level security still holds.
 * The report list reads `open_review_reports()` (ids only) and each report
 * in its own tenant's context.
 *
 * A takedown takes the item off every public surface (slice 3 and 4's
 * reads skip it) and the client's page says why in the reason's fixed
 * sentence (TAKEDOWN_SENTENCES); a post's public copies are deleted. The
 * note is for operators only. A restore lifts it: a post is published again
 * when it is still approved and the client still allows a surface.
 */
@inject()
export default class ReviewOperatorService {
	constructor(private publication: PostPublicationService) {}

	async takedown(
		kind: TakedownKind,
		id: string,
		reason: TakedownReason,
		note: string | null,
	): Promise<void> {
		await this.asOperator(
			kind === "post" ? "post" : "review",
			id,
			async (tenantId) => {
				const now = DateTime.now();
				if (kind === "post") {
					const post = await lockPost(tenantId, id);
					if (!post.takenDownAt) {
						post.takenDownAt = now;
					}
					post.takedownReason = reason;
					post.takedownNote = note;
					await this.publication.sync({ id: tenantId }, post);
				} else if (kind === "review") {
					const review = await lockReview(tenantId, id);
					review.takenDownAt = review.takenDownAt ?? now;
					review.takedownReason = reason;
					review.takedownNote = note;
					// A takedown decides an open report.
					if (review.reportedAt && !review.reportResolvedAt) {
						review.reportResolvedAt = now;
					}
					await review.save();
				} else {
					const review = await lockReview(tenantId, id);
					if (review.reply === null) {
						throw new ReviewOperatorError("That review has no reply.");
					}
					review.replyTakenDownAt = review.replyTakenDownAt ?? now;
					review.replyTakedownReason = reason;
					review.replyTakedownNote = note;
					await review.save();
				}
				logger.info({ tenantId, kind, id, reason }, "Review takedown");
			},
		);
	}

	async restore(kind: TakedownKind, id: string): Promise<void> {
		await this.asOperator(
			kind === "post" ? "post" : "review",
			id,
			async (tenantId) => {
				if (kind === "post") {
					const post = await lockPost(tenantId, id);
					post.takenDownAt = null;
					post.takedownReason = null;
					post.takedownNote = null;
					await this.publication.sync({ id: tenantId }, post);
				} else if (kind === "review") {
					const review = await lockReview(tenantId, id);
					review.takenDownAt = null;
					review.takedownReason = null;
					review.takedownNote = null;
					await review.save();
				} else {
					const review = await lockReview(tenantId, id);
					review.replyTakenDownAt = null;
					review.replyTakedownReason = null;
					review.replyTakedownNote = null;
					await review.save();
				}
				logger.info({ tenantId, kind, id }, "Review takedown lifted");
			},
		);
	}

	/** Closes a review's open report without a takedown: TattooDrip keeps it up. */
	async dismiss(reviewId: string): Promise<void> {
		await this.asOperator("review", reviewId, async (tenantId) => {
			const review = await lockReview(tenantId, reviewId);
			if (!review.reportedAt || review.reportResolvedAt) {
				throw new ReviewOperatorError("That review has no open report.");
			}
			review.reportResolvedAt = DateTime.now();
			await review.save();
			logger.info({ tenantId, reviewId }, "Review report dismissed");
		});
	}

	/**
	 * The open reports across studios, oldest first (at most 500): the ids
	 * from `open_review_reports()`, then each studio's name and slug and the
	 * review read in that studio's own context.
	 */
	async openReports(): Promise<OpenReport[]> {
		const { rows } = await dbClient().rawQuery(
			"select tenant_id, review_id from public.open_review_reports()",
		);
		const reports: OpenReport[] = [];
		for (const row of rows as { tenant_id: string; review_id: string }[]) {
			const report = await withDbContext(
				{ tenantId: row.tenant_id },
				async () => {
					const tenant = await Tenant.query()
						.where("id", row.tenant_id)
						.first();
					const review = await ClientReview.query()
						.where("tenant_id", row.tenant_id)
						.where("id", row.review_id)
						.first();
					if (!tenant || !review?.reportedAt || !review.reportReason)
						return null;
					return {
						tenantId: tenant.id,
						studioSlug: tenant.slug,
						studioName: tenant.name,
						reviewId: review.id,
						reportedAt: review.reportedAt,
						reason: review.reportReason,
						note: review.reportNote,
						rating: review.rating,
						body: review.body,
						shownName: review.shownName,
					};
				},
			);
			if (report) reports.push(report);
		}
		return reports;
	}

	/**
	 * A studio's reviews, replies and posts for the operator's studio page,
	 * read in the studio's own context (`tenantId` is already resolved).
	 * `takenDown` holds every item with a TattooDrip takedown, newest
	 * takedown first; `live` the reviews, replies (not taken down) and
	 * published posts that are not taken down, newest first, at most
	 * `limit`. Deleted rows are left out of both.
	 */
	async studioItems(
		tenantId: string,
		live: { limit: number },
	): Promise<{ takenDown: OperatorItem[]; live: OperatorItem[] }> {
		return withDbContext({ tenantId }, async () => {
			const reviews = await ClientReview.query().where("tenant_id", tenantId);
			const posts = await ClientPost.query().where("tenant_id", tenantId);
			const items: OperatorItem[] = [];
			for (const review of reviews) {
				items.push({
					kind: "review",
					id: review.id,
					at: review.createdAt,
					shownName: review.shownName,
					rating: review.rating,
					excerpt: excerpt(review.body, EXCERPT),
					takedown: review.takenDownAt
						? {
								at: review.takenDownAt,
								reason: review.takedownReason as TakedownReason,
								note: review.takedownNote,
							}
						: null,
				});
				if (review.reply !== null) {
					items.push({
						kind: "reply",
						id: review.id,
						at: review.repliedAt ?? review.createdAt,
						shownName: review.shownName,
						rating: review.rating,
						excerpt: excerpt(review.reply, EXCERPT),
						takedown: review.replyTakenDownAt
							? {
									at: review.replyTakenDownAt,
									reason: review.replyTakedownReason as TakedownReason,
									note: review.replyTakedownNote,
								}
							: null,
					});
				}
			}
			for (const post of posts) {
				// A takedown withdraws the post, clearing publishedAt.
				const at = post.publishedAt ?? post.submittedAt ?? post.createdAt;
				if (!post.takenDownAt && !post.publishedAt) continue;
				items.push({
					kind: "post",
					id: post.id,
					at,
					shownName: post.shownName,
					rating: null,
					excerpt: excerpt(post.caption ?? "", EXCERPT),
					takedown: post.takenDownAt
						? {
								at: post.takenDownAt,
								reason: post.takedownReason as TakedownReason,
								note: post.takedownNote,
							}
						: null,
				});
			}
			const newest = (left: DateTime, right: DateTime) =>
				right.toMillis() - left.toMillis();
			return {
				takenDown: items
					.filter((item) => item.takedown)
					.sort((a, b) =>
						newest(a.takedown?.at as DateTime, b.takedown?.at as DateTime),
					),
				live: items
					.filter((item) => !item.takedown)
					.sort((a, b) => newest(a.at, b.at))
					.slice(0, live.limit),
			};
		});
	}

	/**
	 * Runs an operator action in the item's own tenant context, in one
	 * transaction. An id that is not a uuid, or that no live studio holds,
	 * is ReviewOperatorError.
	 */
	private async asOperator(
		table: "review" | "post",
		id: string,
		fn: (tenantId: string) => Promise<void>,
	): Promise<void> {
		if (!UUID.test(id)) throw new ReviewOperatorError("Give the id as a uuid.");
		const { rows } = await dbClient().rawQuery(LOOKUPS[table], [id]);
		const tenantId: string | null = rows[0]?.id ?? null;
		if (!tenantId) {
			throw new ReviewOperatorError(`No studio has a ${table} with this id.`);
		}
		await withDbContext({ tenantId }, () => fn(tenantId));
	}
}

/** The review, deleted or not, locked in its tenant's context. */
async function lockReview(tenantId: string, id: string): Promise<ClientReview> {
	const review = await ClientReview.withTrashed()
		.where("tenant_id", tenantId)
		.where("id", id)
		.forUpdate()
		.first();
	if (!review) throw new ReviewOperatorError("No review with this id.");
	return review;
}

/** The post, deleted or not, locked in its tenant's context. */
async function lockPost(tenantId: string, id: string): Promise<ClientPost> {
	const post = await ClientPost.withTrashed()
		.where("tenant_id", tenantId)
		.where("id", id)
		.forUpdate()
		.first();
	if (!post) throw new ReviewOperatorError("No post with this id.");
	return post;
}
