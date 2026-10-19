import type { HttpContext } from "@adonisjs/core/http";
import type { NextFn } from "@adonisjs/core/types/http";
import { isApiRequest } from "#services/public_api";

/**
 * Silent auth middleware can be used as a global middleware to silent check
 * if the user is logged-in or not.
 *
 * The request continues as usual, even when the user is not logged-in.
 */
export default class SilentAuthMiddleware {
	async handle(ctx: HttpContext, next: NextFn) {
		// The public API has no session to check (TAT-32).
		if (isApiRequest(ctx)) return next();
		await ctx.auth.check();

		return next();
	}
}
