import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { errors } from "@vinejs/vine";
import { SlugTakenError } from "#modules/tenancy/errors";
import { DEFAULT_TIMEZONE, TENANT_TYPES } from "#modules/tenancy/models/tenant";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import TenancyService from "#modules/tenancy/services/tenancy_service";
import {
	createTenantValidator,
	TIMEZONES,
} from "#modules/tenancy/validators/tenant";

/**
 * A signed-in user creates their first tenant (studio or independent).
 * Users who already belong to a tenant go to the dashboard instead: one
 * tenant per account until the tenant switcher (TAT-25).
 */
@inject()
export default class OnboardingController {
	constructor(private tenancy: TenancyService) {}

	async create({ inertia, response, auth }: HttpContext) {
		if (await this.tenancy.hasTenant(auth.getUserOrFail())) {
			return response.redirect().toRoute("dashboard");
		}

		return inertia.render("onboarding/create_tenant", {
			tenantTypes: [...TENANT_TYPES],
			timezones: TIMEZONES,
			defaultTimezone: DEFAULT_TIMEZONE,
		});
	}

	async store({ request, response, auth }: HttpContext) {
		const user = auth.getUserOrFail();
		if (await this.tenancy.hasTenant(user)) {
			return response.redirect().toRoute("dashboard");
		}

		const input = await request.validateUsing(createTenantValidator);

		try {
			await this.tenancy.createTenant(user, input);
		} catch (error) {
			// Validation saw the slug free, but another signup took it since.
			if (error instanceof SlugTakenError) {
				throw new errors.E_VALIDATION_ERROR([
					{
						field: "slug",
						message: "This address was just taken. Try another one.",
						rule: "unique",
					},
				]);
			}
			throw error;
		}

		response.redirect().toRoute("dashboard");
	}
}
