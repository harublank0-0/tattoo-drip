import type { TransactionClientContract } from "@adonisjs/lucid/types/database";
import {
	ReviewLockedError,
	ReviewTakenDownError,
} from "#modules/reviews/errors";
import ClientReview from "#modules/reviews/models/client_review";
import type { ReviewContext } from "#modules/reviews/review_context";
import { reviewEditable } from "#modules/reviews/rules";
import type {
	SharedChoices,
	Submitter,
} from "#modules/reviews/services/client_post_service";
import type Tenant from "#modules/tenancy/models/tenant";

type TenantRef = Pick<Tenant, "id">;

/**
 * Client reviews (Reviews and Fresh ink, rulings 5, 6 and 8): one live
 * review per project, written, changed and deleted through the project's
 * review link. Writes run inside ReviewPageService's transaction, under the
 * project's row lock, so two submits of one link never make two reviews
 * (the partial unique index is the backstop). The studio's reply and
 * report, and TattooDrip's takedown, are later slices; a taken-down review
 * keeps its rating and text (ReviewLockedError) but its consents, its name
 * and its delete stay the client's.
 */
export default class ClientReviewService {
	/** The project's live review, or null. */
	async find(
		tenant: TenantRef,
		projectId: string,
		trx?: TransactionClientContract,
	): Promise<ClientReview | null> {
		const query = trx
			? ClientReview.query({ client: trx }).forUpdate()
			: ClientReview.query();
		return query
			.where("tenant_id", tenant.id)
			.where("project_id", projectId)
			.first();
	}

	/**
	 * Whether a new review is barred (finding 1): the project's latest review,
	 * deleted or not, was taken down by TattooDrip, so deleting it and writing
	 * it again can't get around the takedown until an operator restores it.
	 */
	async newReviewBlocked(
		tenant: TenantRef,
		projectId: string,
	): Promise<boolean> {
		const latest = await ClientReview.withTrashed()
			.where("tenant_id", tenant.id)
			.where("project_id", projectId)
			.orderBy("created_at", "desc")
			.orderBy("id", "desc")
			.first();
		return Boolean(latest?.takenDownAt);
	}

	/** Writes the review's rating and text, making the review if there is none. */
	async save(
		trx: TransactionClientContract,
		ctx: ReviewContext,
		input: { rating: number; body: string },
		shared: SharedChoices,
		submitter?: Submitter,
	): Promise<ClientReview> {
		const review = await this.find(ctx.tenant, ctx.project.id, trx);
		if (!review) {
			if (await this.newReviewBlocked(ctx.tenant, ctx.project.id)) {
				throw new ReviewTakenDownError();
			}
			return ClientReview.create(
				{
					tenantId: ctx.tenant.id,
					projectId: ctx.project.id,
					clientId: ctx.client.id,
					artistId: ctx.artistId,
					rating: input.rating,
					body: input.body,
					shownName: shared.shownName,
					consentStudioPage: shared.consentStudioPage,
					consentDiscover: shared.consentDiscover,
					submitterDigest: submitter?.digest ?? null,
					submitterRecordedAt: submitter?.at ?? null,
				},
				{ client: trx },
			);
		}
		if (review.rating === input.rating && review.body === input.body) {
			return review;
		}
		if (!reviewEditable(review)) throw new ReviewLockedError();
		review.rating = input.rating;
		review.body = input.body;
		if (submitter) {
			review.submitterDigest = submitter.digest;
			review.submitterRecordedAt = submitter.at;
		}
		await review.save();
		return review;
	}

	/** The shown name and the consents on the project's live review, if any (ruling 8). */
	async applyShared(
		trx: TransactionClientContract,
		ctx: ReviewContext,
		shared: SharedChoices,
	): Promise<void> {
		// Never a deleted review (finding 6): its scrubbed name stays scrubbed.
		await ClientReview.query({ client: trx })
			.where("tenant_id", ctx.tenant.id)
			.where("project_id", ctx.project.id)
			.whereNull("deleted_at")
			.update({
				shown_name: shared.shownName,
				consent_studio_page: shared.consentStudioPage,
				consent_discover: shared.consentDiscover,
				updated_at: new Date(),
			});
	}

	/**
	 * The client deletes their review (ruling 2, finding 22): the rating,
	 * text, name and consents are scrubbed and the row soft-deleted, so only
	 * its ids, dates, any reply and report, and any takedown record stay (the
	 * studio's record that a review existed). The client may write a new one
	 * through the link, unless this one was taken down. Nothing to delete is
	 * no error.
	 */
	async delete(
		trx: TransactionClientContract,
		ctx: ReviewContext,
	): Promise<void> {
		const review = await this.find(ctx.tenant, ctx.project.id, trx);
		if (review) await scrub(review, trx);
	}

	/** Every review of the client, live or deleted, scrubbed (the privacy deletion, finding 8). */
	async eraseForClient(
		trx: TransactionClientContract,
		tenant: TenantRef,
		clientId: string,
	): Promise<void> {
		const reviews = await ClientReview.withTrashed()
			.where("tenant_id", tenant.id)
			.where("client_id", clientId)
			.forUpdate();
		for (const review of reviews) {
			review.submitterDigest = null;
			review.submitterRecordedAt = null;
			await scrub(review, trx);
		}
	}
}

/** The rating, text, name and consents gone; soft-deleted if it wasn't. */
async function scrub(review: ClientReview, trx: TransactionClientContract) {
	review.rating = null;
	review.body = "";
	review.shownName = "";
	review.consentStudioPage = false;
	review.consentDiscover = false;
	// biome-ignore lint/correctness/useHookAtTopLevel: Lucid's useTransaction, not a React hook.
	if (review.deletedAt) await review.useTransaction(trx).save();
	else await review.softDelete(trx);
}
