import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { SENT_TO_FLASH } from "#modules/identity/account_tokens";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import AccountService from "#modules/identity/services/account_service";
import { signupValidator } from "#validators/user";

/**
 * Self-signup (TAT-18). The answer is the same for a new address and a taken
 * one: "Check your email", and nobody signed in. AccountService decides what
 * the email says.
 */
@inject()
export default class NewAccountController {
	constructor(private accounts: AccountService) {}

	async create({ inertia }: HttpContext) {
		return inertia.render("auth/signup", {});
	}

	async store({ request, response, session }: HttpContext) {
		const input = await request.validateUsing(signupValidator);
		await this.accounts.signUp(input);
		session.flash(SENT_TO_FLASH, input.email);
		return response.redirect().toRoute("new_account.sent");
	}

	async sent({ inertia, session }: HttpContext) {
		const email = session.flashMessages.get(SENT_TO_FLASH);
		return inertia.render("auth/check_email", {
			purpose: "signup",
			email: typeof email === "string" ? email : null,
		});
	}
}
