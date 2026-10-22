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
	 * /t/:tenant: every member lands on Today (TAT-107), what needs them right
	 * now. The studio switcher and /dashboard link here; Today's own links go
	 * on to the Inbox, Projects and the calendar.
	 */
	async tenantHome(ctx: HttpContext) {
		ctx.session.reflash();
		const { tenant } = tenantContext(ctx);
		return ctx.response
			.redirect()
			.toRoute("tenant.today", { tenant: tenant.slug });
	}
}
