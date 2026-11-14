import { errors, type HttpContext } from "@adonisjs/core/http";
import type { NextFn } from "@adonisjs/core/types/http";
import { reviewsEnabled } from "#modules/reviews/review_links";

/**
 * The dashboard's review routes (Reviews and Fresh ink, slice 2): while
 * REVIEWS_ENABLED is off, each is the same 404 as an unknown URL, before the
 * controller reads anything. Runs after the /t/:tenant group's middleware
 * (the role check last there), on the reviews routes only.
 */
export default class ReviewsOnMiddleware {
	async handle(ctx: HttpContext, next: NextFn) {
		if (!reviewsEnabled()) {
			throw new errors.E_ROUTE_NOT_FOUND([
				ctx.request.method(),
				ctx.request.url(),
			]);
		}
		return next();
	}
}
