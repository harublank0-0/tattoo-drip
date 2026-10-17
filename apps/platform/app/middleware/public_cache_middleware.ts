import type { HttpContext } from "@adonisjs/core/http";
import type { NextFn } from "@adonisjs/core/types/http";
import {
	type PublicCacheOptions,
	publicCacheControl,
	READ_METHODS,
} from "#services/public_api";

/**
 * Makes a public read cacheable (TAT-32): a 200 GET or HEAD gets
 * `Cache-Control: public, max-age=60, stale-while-revalidate=600` (or the
 * seconds given) and a strong ETag, and a request whose If-None-Match still
 * matches gets a 304. Errors and other methods keep publicApi's no-store.
 * Opt-in per route (a test makes every API GET route decide). Never use it
 * on a response that isn't the same for everyone, such as a deposit page
 * (TAT-65).
 *
 *   router.get("/", [controllers.PublicStudio, "show"]).use(middleware.publicCache())
 */
export default class PublicCacheMiddleware {
	async handle(
		ctx: HttpContext,
		next: NextFn,
		options: PublicCacheOptions = {},
	) {
		await next();
		const content = ctx.response.content;
		if (
			!READ_METHODS.has(ctx.request.method()) ||
			ctx.response.getStatus() !== 200 ||
			!content
		) {
			return;
		}
		ctx.response.header("Cache-Control", publicCacheControl(options));
		// The same body again, with an ETag: when Adonis writes it, a matching
		// If-None-Match becomes a 304.
		ctx.response.send(content[0], true);
	}
}
