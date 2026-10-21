import { errors, type HttpContext } from "@adonisjs/core/http";
import type { NextFn } from "@adonisjs/core/types/http";
import { tenantContext } from "#middleware/tenant_middleware";
import { rolesFor } from "#modules/tenancy/access";

/**
 * Lets a member use a tenant route only when TENANT_ROUTE_ROLES
 * (#modules/tenancy/access, TAT-30) gives their role that route. Everyone
 * else gets the same 404 as an unknown URL, like the tenant middleware, so
 * a URL never reveals that a page exists. A route the table doesn't name is
 * a programming error and fails loudly; tenant_routes.spec.ts keeps the
 * table and the routes in step. It runs on the /t/:tenant group after the
 * tenant middleware: tenantContext() throws without it.
 */
export default class RoleMiddleware {
	async handle(ctx: HttpContext, next: NextFn) {
		const { membership } = tenantContext(ctx);
		const roles = rolesFor(ctx.route?.name);
		if (!roles) {
			throw new Error(
				`No TENANT_ROUTE_ROLES entry for ${ctx.request.method()} ${ctx.route?.pattern ?? ctx.request.url()} (#modules/tenancy/access)`,
			);
		}
		if (!roles.includes(membership.role)) {
			throw new errors.E_ROUTE_NOT_FOUND([
				ctx.request.method(),
				ctx.request.url(),
			]);
		}
		return next();
	}
}
