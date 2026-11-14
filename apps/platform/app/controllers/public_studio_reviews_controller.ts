import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { errors } from "@vinejs/vine";
import { publicTenantContext } from "#middleware/public_tenant_middleware";
import {
	decodeWorkCursor,
	type WorkCursor,
} from "#modules/artists/work_cursor";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import PublicReviewService from "#modules/reviews/services/public_review_service";
import { listPublicReviewsValidator } from "#modules/reviews/validators/public_reads";
import {
	CURSOR_MESSAGE,
	WORK_PAGE_SIZE,
} from "#modules/storefront/validators/work";
import PublicFreshInkPostTransformer from "#transformers/public_fresh_ink_post_transformer";
import PublicStudioReviewTransformer from "#transformers/public_studio_review_transformer";

/**
 * What the studio's own page shows of its clients' reviews and Fresh ink on
 * the public API (listReviews and listFreshInk in openapi.yaml; Reviews and
 * Fresh ink, slice 3): a page of each, newest first, with the cursor of the
 * next page, and for reviews the studio's average and count from 3 reviews.
 * Only the query string is read; a refused parameter or cursor is the 422
 * validation_failed with that field. While REVIEWS_ENABLED is off both are
 * empty pages (PublicReviewService).
 */
@inject()
export default class PublicStudioReviewsController {
	constructor(private reviews: PublicReviewService) {}

	async index(ctx: HttpContext) {
		const { tenant } = publicTenantContext(ctx);
		const query = await readQuery(ctx);
		const page = await this.reviews.reviews(tenant, query);
		// serialize wraps only `data`: the cursor and the rating join it.
		return {
			...(await ctx.serialize(
				PublicStudioReviewTransformer.transform(page.reviews),
			)),
			nextCursor: page.nextCursor,
			rating: page.rating
				? { average: page.rating.average, count: page.rating.count }
				: null,
		};
	}

	async freshInk(ctx: HttpContext) {
		const { tenant } = publicTenantContext(ctx);
		const query = await readQuery(ctx);
		const page = await this.reviews.freshInk(tenant, query);
		return {
			...(await ctx.serialize(
				PublicFreshInkPostTransformer.transform(page.posts),
			)),
			nextCursor: page.nextCursor,
		};
	}
}

/** The checked query: the cursor decoded (a malformed one is the 422 on `cursor`) and the page size. */
async function readQuery(
	ctx: HttpContext,
): Promise<{ cursor: WorkCursor | null; limit: number }> {
	const query = await ctx.request.validateUsing(listPublicReviewsValidator, {
		data: ctx.request.qs(),
	});
	// decodeWorkCursor takes the validator's string only.
	const cursor =
		query.cursor === undefined ? null : decodeWorkCursor(query.cursor);
	if (query.cursor !== undefined && cursor === null) {
		throw new errors.E_VALIDATION_ERROR([
			{ field: "cursor", message: CURSOR_MESSAGE, rule: "cursor" },
		]);
	}
	return { cursor, limit: query.limit ?? WORK_PAGE_SIZE };
}
