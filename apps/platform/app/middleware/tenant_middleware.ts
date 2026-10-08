import { inject } from "@adonisjs/core";
import { errors, type HttpContext } from "@adonisjs/core/http";
import type { NextFn } from "@adonisjs/core/types/http";
import type Tenant from "#modules/tenancy/models/tenant";
import type TenantMembership from "#modules/tenancy/models/tenant_membership";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import TenancyService from "#modules/tenancy/services/tenancy_service";

/**
 * Session key for the tenant the user opened last; /dashboard returns there.
 */
export const LAST_TENANT_KEY = "last_tenant_slug";

declare module "@adonisjs/core/http" {
	interface HttpContext {
		/** The tenant from the URL, set by the tenant middleware. */
		tenant: Tenant;
		/** The signed-in user's membership in `tenant`. */
		membership: TenantMembership;
	}
}

/**
 * Resolves `:tenant` from the URL and checks the signed-in user's live
 * membership in it, on every request (no caching), so removing a member
 * or deleting a tenant takes effect immediately. Anything else is the same
 * 404 as an unknown URL, so a URL never reveals that a tenant exists.
 *
 * Use after the auth middleware on the /t/:tenant route group.
 */
@inject()
export default class TenantMiddleware {
	constructor(private tenancy: TenancyService) {}

	async handle(ctx: HttpContext, next: NextFn) {
		const user = ctx.auth.getUserOrFail();
		const found = await this.tenancy.membershipFor(user, ctx.params.tenant);
		if (!found) {
			throw new errors.E_ROUTE_NOT_FOUND([
				ctx.request.method(),
				ctx.request.url(),
			]);
		}

		ctx.tenant = found.tenant;
		ctx.membership = found.membership;
		ctx.session.put(LAST_TENANT_KEY, found.tenant.slug);

		ctx.inertia.share({
			tenant: {
				name: found.tenant.name,
				slug: found.tenant.slug,
				type: found.tenant.type,
				role: found.membership.role,
			},
			// The switcher list: only this user's live tenants.
			tenants: async () =>
				(await this.tenancy.tenantsFor(user)).map(({ tenant, role }) => ({
					name: tenant.name,
					slug: tenant.slug,
					role,
				})),
		});

		return next();
	}
}
