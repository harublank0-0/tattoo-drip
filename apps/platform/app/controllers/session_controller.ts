import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import User from "#models/user";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import TenancyService from "#modules/tenancy/services/tenancy_service";
import { loginValidator } from "#validators/user";

@inject()
export default class SessionController {
	constructor(private tenancy: TenancyService) {}

	async create({ inertia }: HttpContext) {
		return inertia.render("auth/login", {});
	}

	async store({ request, auth, response }: HttpContext) {
		const { email, password } = await request.validateUsing(loginValidator);
		const user = await User.verifyCredentials(email, password);

		await auth.use("web").login(user);
		const tenants = await this.tenancy.tenantsFor(user);
		response
			.redirect()
			.toRoute(tenants.length === 0 ? "onboarding.create" : "dashboard");
	}

	async destroy({ auth, response }: HttpContext) {
		await auth.use("web").logout();
		response.redirect().toRoute("session.create");
	}
}
