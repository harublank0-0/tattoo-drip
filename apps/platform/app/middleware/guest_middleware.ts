import type { Authenticators } from "@adonisjs/auth/types";
import type { HttpContext } from "@adonisjs/core/http";
import type { NextFn } from "@adonisjs/core/types/http";

/**
 * Guest middleware is used to deny access to routes that should
 * be accessed by unauthenticated users.
 *
 * For example, the login page should not be accessible if the user
 * is already logged-in
 */
export default class GuestMiddleware {
	/**
	 * Where a signed-in visitor of a guest page goes: their studio, through
	 * /dashboard (TAT-18; it was the starter kit's home page). A reset link
	 * opened while signed in stays valid for its hour.
	 */
	redirectTo = "/dashboard";

	async handle(
		ctx: HttpContext,
		next: NextFn,
		options: { guards?: (keyof Authenticators)[] } = {},
	) {
		for (const guard of options.guards || [ctx.auth.defaultGuard]) {
			if (await ctx.auth.use(guard).check()) {
				ctx.session.reflash();
				return ctx.response.redirect(this.redirectTo, true);
			}
		}

		/**
		 * Nobody is signed in here (login, signup), so clear the tab's page
		 * history: Back can't decrypt the previous user's pages and asks the
		 * server again (TAT-82). Logout and an expired session redirect here.
		 * Inertia sends the flag only with a rendered page, so logout itself,
		 * a redirect, can't clear it.
		 */
		ctx.inertia.clearHistory();
		return next();
	}
}
