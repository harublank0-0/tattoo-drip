import type { HttpContext } from "@adonisjs/core/http";
import type { NextFn } from "@adonisjs/core/types/http";

/**
 * The one gate for "needs a confirmed email address" (TAT-18): creating a
 * tenant now, accepting an invitation with TAT-33. Use it after auth. An
 * account whose address isn't confirmed goes to the page that asks for it,
 * whatever the method, and nothing it sent is used.
 */
export default class VerifiedEmailMiddleware {
	async handle(ctx: HttpContext, next: NextFn) {
		if (!ctx.auth.getUserOrFail().emailVerified) {
			return ctx.response.redirect().toRoute("email_verification.notice");
		}
		return next();
	}
}
