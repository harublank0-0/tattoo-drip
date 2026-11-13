import type { TransactionClientContract } from "@adonisjs/lucid/types/database";
import { ReviewLockedError } from "#modules/reviews/errors";
import ClientReview from "#modules/reviews/models/client_review";
import type { ReviewContext } from "#modules/reviews/review_context";
import { reviewEditable } from "#modules/reviews/rules";
import type { SharedChoices } from "#modules/reviews/services/client_post_service";
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

	/** Writes the review's rating and text, making the review if there is none. */
	async save(
		trx: TransactionClientContract,
		ctx: ReviewContext,
		input: { rating: number; body: string },
		shared: SharedChoices,
	): Promise<ClientReview> {
		const review = await this.find(ctx.tenant, ctx.project.id, trx);
		if (!review) {
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
		await review.save();
		return review;
	}

	/** The shown name and the consents on the project's live review, if any (ruling 8). */
	async applyShared(
		trx: TransactionClientContract,
		ctx: ReviewContext,
		shared: SharedChoices,
	): Promise<void> {
		await ClientReview.query({ client: trx })
			.where("tenant_id", ctx.tenant.id)
			.where("project_id", ctx.project.id)
			.update({
				shown_name: shared.shownName,
				consent_studio_page: shared.consentStudioPage,
				consent_discover: shared.consentDiscover,
				updated_at: new Date(),
			});
	}

	/**
	 * The client deletes their review (ruling 2): a soft delete, the
	 * studio's record; nothing public reads it, and the client may write a
	 * new one through the link. Nothing to delete is no error.
	 */
	async delete(
		trx: TransactionClientContract,
		ctx: ReviewContext,
	): Promise<void> {
		const review = await this.find(ctx.tenant, ctx.project.id, trx);
		if (review) await review.softDelete(trx);
	}
}
