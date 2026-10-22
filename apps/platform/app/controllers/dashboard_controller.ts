import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { LAST_TENANT_KEY, tenantContext } from "#middleware/tenant_middleware";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import TenancyService from "#modules/tenancy/services/tenancy_service";

/**
 * /dashboard is where login, signup and onboarding land. It sends the user
 * to the tenant they opened last, if they still belong to it, otherwise to
 * their oldest tenant, otherwise to onboarding.
 */
@inject()
export default class DashboardController {
	constructor(private tenancy: TenancyService) {}

	async show({ auth, session, response }: HttpContext) {
		// A message flashed for the page this lands on (a throttled account
		// link, TAT-119) must outlive this hop and the studio home's.
		session.reflash();
		const tenants = await this.tenancy.tenantsFor(auth.getUserOrFail());
		if (tenants.length === 0) {
			return response.redirect().toRoute("onboarding.create");
		}

		const lastSlug = session.get(LAST_TENANT_KEY);
		const { tenant } =
			tenants.find(({ tenant }) => tenant.slug === lastSlug) ?? tenants[0];

		return response
			.redirect()
			.toRoute("tenant.dashboard", { tenant: tenant.slug });
	}

	/**
	 * /t/:tenant: the member's work list. Owners land on the inbox, artists
	 * on their projects (the inbox is owners only). The studio switcher and
	 * /dashboard link here, so everyone lands on what they work through.
	 */
	async tenantHome(ctx: HttpContext) {
		ctx.session.reflash();
		const { tenant, membership } = tenantContext(ctx);
		return ctx.response
			.redirect()
			.toRoute(
				membership.role === "owner"
					? "tenant.inbox.index"
					: "tenant.projects.index",
				{ tenant: tenant.slug },
			);
	}
}
