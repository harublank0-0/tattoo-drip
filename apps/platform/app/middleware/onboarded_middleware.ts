import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import type { NextFn } from "@adonisjs/core/types/http";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import TenancyService from "#modules/tenancy/services/tenancy_service";

/**
 * Sends signed-in users who don't belong to a tenant yet to onboarding.
 * Use after the auth middleware, on pages that need a tenant. TAT-25's
 * tenant context middleware replaces this for /t/:slug routes.
 */
@inject()
export default class OnboardedMiddleware {
	constructor(private tenancy: TenancyService) {}

	async handle(ctx: HttpContext, next: NextFn) {
		if (!(await this.tenancy.hasTenant(ctx.auth.getUserOrFail()))) {
			return ctx.response.redirect().toRoute("onboarding.create");
		}

		return next();
	}
}
