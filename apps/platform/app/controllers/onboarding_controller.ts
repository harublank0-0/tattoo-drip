import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { errors } from "@vinejs/vine";
import { SlugTakenError } from "#modules/tenancy/errors";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import TenancyService from "#modules/tenancy/services/tenancy_service";
import {
	createTenantValidator,
	TIMEZONES,
} from "#modules/tenancy/validators/tenant";

/**
 * A signed-in user creates their first tenant (studio or independent).
 */
@inject()
export default class OnboardingController {
	constructor(private tenancy: TenancyService) {}

	async create({ inertia }: HttpContext) {
		return inertia.render("onboarding/create_tenant", { timezones: TIMEZONES });
	}

	async store({ request, response, auth }: HttpContext) {
		const input = await request.validateUsing(createTenantValidator);

		try {
			await this.tenancy.createTenant(auth.getUserOrFail(), input);
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
