import type { HttpContext } from "@adonisjs/core/http";
import type { NextFn } from "@adonisjs/core/types/http";
import limiter from "@adonisjs/limiter/services/main";
import {
	REVIEW_LIMITS,
	type ReviewAction,
	reviewLimitKeys,
} from "#modules/reviews/review_limits";
import {
	REVIEW_TOKEN,
	REVIEW_TOKEN_HEADER,
	reviewsEnabled,
} from "#modules/reviews/review_links";
import { callerIp } from "#services/api_caller";
import { READ_METHODS } from "#services/public_api";
import { ApiException } from "#services/public_api_errors";

const STAGE_ROUTE = "api.v1.review.videos.stage";

/**
 * The routes that carry a file: counted as uploads. A video's sign counts as
 * a write (finding 7): with the reservation cap it bounds staged objects
 * without a bot challenge per file.
 */
const UPLOAD_ROUTES = new Set([
	"api.v1.review.photos.store",
	"api.v1.review.videos.stage",
	"api.v1.review.videos.store",
]);

/**
 * Every review page route (Reviews and Fresh ink, slice 1), after
 * publicTenant: the feature flag first (off, every route is the same 404 as
 * an unknown path, before anything is counted or read), then the rate
 * limits per client address and per link token (reads, writes and uploads
 * apart; the deposit page's model, TAT-65), before the handler reads any
 * body. The token comes from the X-Review-Token header, never the URL: a
 * missing or malformed one is counted against its address and is the 404,
 * so guessing costs the guesser. The counts live on the limiter's own
 * connection, so a request that fails later still counts. Counted by the
 * caller's address (`callerIp`: the storefront's visitor with a valid
 * server key, TAT-38). The token is never logged and never in an error.
 */
export default class ReviewGuardMiddleware {
	async handle(ctx: HttpContext, next: NextFn) {
		if (!reviewsEnabled()) throw ApiException.notFound();
		const action: ReviewAction = READ_METHODS.has(ctx.request.method())
			? "read"
			: UPLOAD_ROUTES.has(ctx.route?.name ?? "")
				? "upload"
				: "write";
		const limits = REVIEW_LIMITS[action];
		// The local upload route (development and tests) is a presigned PUT's
		// stand-in: its upload token is its credential, counted in its place.
		const staging = ctx.route?.name === STAGE_ROUTE;
		const token = staging
			? String(ctx.request.qs().upload ?? "")
			: (ctx.request.header(REVIEW_TOKEN_HEADER) ?? "");
		const keys = reviewLimitKeys(action, callerIp(ctx), token);
		await limiter.use({ ...limits.perAddress }).consume(keys.perAddress);
		if (staging ? token === "" : !REVIEW_TOKEN.test(token)) {
			throw ApiException.notFound();
		}
		await limiter.use({ ...limits.perToken }).consume(keys.perToken);
		return next();
	}
}
