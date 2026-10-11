import type { HttpContext } from "@adonisjs/core/http";
import type { NextFn } from "@adonisjs/core/types/http";
import { runInRequestTransaction } from "#services/db_context";

/**
 * Runs the rest of an authenticated request in one transaction that
 * carries the signed-in user's id for the database's row-level security
 * policies. The tenant middleware adds the tenant once it knows it.
 *
 * It commits when the response succeeds. A failed request is rolled back
 * by the exception handler (abortRequestTransaction), not here: Adonis
 * resolves `next()` even when a controller threw, so waiting for a throw
 * would commit failed requests.
 *
 * Use right after the auth middleware. Public routes get no transaction.
 */
export default class DbContextMiddleware {
	async handle(ctx: HttpContext, next: NextFn) {
		const user = ctx.auth.getUserOrFail();
		return runInRequestTransaction({ userId: user.id }, () => next());
	}
}
