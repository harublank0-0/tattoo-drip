import type { HttpContext } from "@adonisjs/core/http";
import { LAST_TENANT_KEY } from "#middleware/tenant_middleware";
import User from "#models/user";
import { loginValidator } from "#validators/user";

export default class SessionController {
	async create({ inertia }: HttpContext) {
		return inertia.render("auth/login", {});
	}

	/**
	 * /dashboard picks where the user lands. Login and logout forget the
	 * last tenant, so a shared browser never carries one user's choice over
	 * to the next.
	 */
	async store({ request, auth, session, response }: HttpContext) {
		const { email, password } = await request.validateUsing(loginValidator);
		const user = await User.verifyCredentials(email, password);

		await auth.use("web").login(user);
		session.forget(LAST_TENANT_KEY);
		response.redirect().toRoute("dashboard");
	}

	async destroy({ auth, session, response }: HttpContext) {
		await auth.use("web").logout();
		session.forget(LAST_TENANT_KEY);
		response.redirect().toRoute("session.create");
	}
}
