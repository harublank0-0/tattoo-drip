import type { HttpContext } from "@adonisjs/core/http";
import { LAST_TENANT_KEY } from "#middleware/tenant_middleware";
import User from "#models/user";
import { forgetStagedTokens } from "#modules/identity/account_tokens";
import { throttleLogin } from "#modules/identity/services/auth_limits";
import { loginValidator } from "#validators/user";

export default class SessionController {
	async create({ inertia }: HttpContext) {
		return inertia.render("auth/login", {});
	}

	/**
	 * /dashboard picks where the user lands. Login and logout forget the
	 * last tenant and any staged reset or confirmation link (TAT-18), so a
	 * shared browser never carries one user's choice, or half-used link, over
	 * to the next. Too many failures from this address or for this email
	 * refuse the attempt before the password is checked (TAT-8).
	 */
	async store({ request, auth, session, response }: HttpContext) {
		const { email, password } = await request.validateUsing(loginValidator);
		const user = await throttleLogin(request.ip(), email, () =>
			User.verifyCredentials(email, password),
		);

		await auth.use("web").login(user);
		session.forget(LAST_TENANT_KEY);
		forgetStagedTokens(session);
		response.redirect().toRoute("dashboard");
	}

	async destroy({ auth, session, response }: HttpContext) {
		await auth.use("web").logout();
		session.forget(LAST_TENANT_KEY);
		forgetStagedTokens(session);
		response.redirect().toRoute("session.create");
	}
}
