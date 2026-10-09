import { errors, type HttpContext } from "@adonisjs/core/http";
import type { NextFn } from "@adonisjs/core/types/http";
import { tenantContext } from "#middleware/tenant_middleware";
import type { MembershipRole } from "#modules/tenancy/models/tenant_membership";

/**
 * Lets only members with one of the allowed roles through, e.g.
 * `middleware.role({ allow: ["owner"] })`. Everyone else gets the same 404
 * as an unknown URL, like the tenant middleware, so a URL never reveals
 * that a page exists. Use after the tenant middleware: tenantContext()
 * throws without it.
 */
export default class RoleMiddleware {
	async handle(
		ctx: HttpContext,
		next: NextFn,
		options: { allow: MembershipRole[] },
	) {
		const { membership } = tenantContext(ctx);
		if (!options.allow.includes(membership.role)) {
			throw new errors.E_ROUTE_NOT_FOUND([
				ctx.request.method(),
				ctx.request.url(),
			]);
		}
		return next();
	}
}
