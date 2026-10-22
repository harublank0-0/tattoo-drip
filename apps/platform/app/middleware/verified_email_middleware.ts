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
			// A message flashed for the page this chain ends on (a throttled
			// account link sent here through /dashboard and /onboarding,
			// TAT-119) must outlive this hop, as /dashboard's do.
			ctx.session.reflash();
			return ctx.response.redirect().toRoute("email_verification.notice");
		}
		return next();
	}
}
