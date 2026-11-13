import type { HttpContext } from "@adonisjs/core/http";
import { errors } from "@adonisjs/core/http";
import type { NextFn } from "@adonisjs/core/types/http";
import { isPlatformAdmin } from "#services/platform_admins";

/**
 * TattooDrip's own staff pages (/admin): an account whose confirmed
 * address is listed in PLATFORM_ADMIN_EMAILS. Anyone else gets the 404 of
 * an unknown page. Use after auth and dbContext. It grants no database
 * reach: admin pages read each studio in its own context.
 */
export default class PlatformAdminMiddleware {
	async handle(ctx: HttpContext, next: NextFn) {
		if (!isPlatformAdmin(ctx.auth.getUserOrFail())) {
			throw new errors.E_ROUTE_NOT_FOUND([
				ctx.request.method(),
				ctx.request.url(),
			]);
		}
		return next();
	}
}
