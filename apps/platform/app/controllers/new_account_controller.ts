import type { HttpContext } from "@adonisjs/core/http";
import User from "#models/user";
import { signupValidator } from "#validators/user";

export default class NewAccountController {
	async create({ inertia }: HttpContext) {
		return inertia.render("auth/signup", {});
	}

	async store({ request, response, auth }: HttpContext) {
		const { fullName, email, password } =
			await request.validateUsing(signupValidator);
		const user = await User.create({ fullName, email, password });

		await auth.use("web").login(user);
		// A new account has no tenant yet.
		response.redirect().toRoute("onboarding.create");
	}
}
