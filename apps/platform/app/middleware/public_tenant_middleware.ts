import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import type { NextFn } from "@adonisjs/core/types/http";
import Tenant from "#modules/tenancy/models/tenant";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import TenancyService from "#modules/tenancy/services/tenancy_service";
import { STORED_SLUG } from "#modules/tenancy/slugs";
import {
	runInRequestTransaction,
	setRequestContext,
} from "#services/db_context";
import { READ_METHODS } from "#services/public_api";
import { ApiException } from "#services/public_api_errors";

declare module "@adonisjs/core/http" {
	interface HttpContext {
		/**
		 * The tenant from a public API path. Only set on /api/v1/tenants/:tenant
		 * routes; read it with publicTenantContext(ctx).
		 */
		publicTenant?: Tenant;
	}
}

/**
 * Resolves `:tenant` on the public API (TAT-32) and runs the rest of the
 * request in one transaction with that tenant's database context, so every
 * query is RLS-scoped to it. There is no user: app.user_id stays unset, also
 * when the request carries a dashboard session cookie.
 *
 * The slug is matched exactly. One without the shape of a stored slug (the
 * tenant_slugs CHECK, never checkSlug, so grandfathered slugs keep working)
 * is a 404 without a query. An old slug (TAT-24) serves reads like the
 * current one, and the tenant resource names the current slug; any other
 * method under an old slug is a 404, so a write never goes through an
 * alias. Unknown, deleted and shapeless slugs get the same 404.
 *
 * Use after publicApi on the /api/v1/tenants/:tenant group.
 */
@inject()
export default class PublicTenantMiddleware {
	constructor(private tenancy: TenancyService) {}

	async handle(ctx: HttpContext, next: NextFn) {
		const slug = ctx.params.tenant;
		if (typeof slug !== "string" || !STORED_SLUG.test(slug)) {
			throw ApiException.notFound();
		}

		return runInRequestTransaction({}, async () => {
			const tenantId = await this.tenancy.tenantIdForSlug(slug);
			if (!tenantId) throw ApiException.notFound();
			await setRequestContext({ tenantId });

			// RLS shows exactly this tenant's row now.
			const tenant = await Tenant.find(tenantId);
			if (!tenant) throw ApiException.notFound();
			if (tenant.slug !== slug && !READ_METHODS.has(ctx.request.method())) {
				throw ApiException.notFound();
			}

			ctx.publicTenant = tenant;
			return next();
		});
	}
}

/**
 * The tenant the publicTenant middleware resolved. Throws outside the
 * /api/v1/tenants/:tenant group, so an endpoint that forgot it fails
 * loudly instead of running without a tenant.
 */
export function publicTenantContext(ctx: HttpContext): { tenant: Tenant } {
	if (!ctx.publicTenant) {
		throw new Error(
			"No public tenant on this request: the route must be in the /api/v1/tenants/:tenant group with the publicTenant middleware",
		);
	}
	return { tenant: ctx.publicTenant };
}
