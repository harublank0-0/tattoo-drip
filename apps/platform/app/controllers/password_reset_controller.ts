import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import {
	SENT_TO_FLASH,
	SESSION_TOKEN_KEYS,
} from "#modules/identity/account_tokens";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import AccountService from "#modules/identity/services/account_service";
import {
	newPasswordValidator,
	passwordResetRequestValidator,
} from "#validators/user";

const TOKEN_KEY = SESSION_TOKEN_KEYS.reset_password;

/**
 * Password reset (TAT-18). Guest pages only: the guest group clears page
 * history (TAT-82). Asking for a link answers the same whether or not an
 * account uses the address. The emailed link's GET only moves its token
 * into the session and opens /reset-password, whose URL holds no token; the
 * new password is that page's POST, so a mail scanner that opens the link
 * changes nothing.
 */
@inject()
export default class PasswordResetController {
	constructor(private accounts: AccountService) {}

	async create({ inertia }: HttpContext) {
		return inertia.render("auth/forgot_password", {});
	}

	async store({ request, response, session }: HttpContext) {
		const { email } = await request.validateUsing(
			passwordResetRequestValidator,
		);
		await this.accounts.requestPasswordReset(email);
		session.flash(SENT_TO_FLASH, email);
		return response.redirect().toRoute("password_reset.sent");
	}

	async sent({ inertia, session }: HttpContext) {
		const email = session.flashMessages.get(SENT_TO_FLASH);
		return inertia.render("auth/check_email", {
			purpose: "reset",
			email: typeof email === "string" ? email : null,
		});
	}

	async link({ params, session, response }: HttpContext) {
		session.put(TOKEN_KEY, params.token);
		response.header("Referrer-Policy", "no-referrer");
		response.header("Cache-Control", "no-store");
		return response.redirect().toRoute("password_reset.edit");
	}

	async edit({ session, inertia, response }: HttpContext) {
		response.header("Cache-Control", "no-store");
		response.header("Referrer-Policy", "same-origin");
		const token = session.get(TOKEN_KEY);
		const found =
			typeof token === "string"
				? await this.accounts.tokenState(token, "reset_password")
				: { state: "unknown" as const };
		if (found.state === "live") {
			return inertia.render("auth/reset_password", {
				state: "ready",
				email: found.email,
			});
		}
		return inertia.render("auth/reset_password", {
			state: found.state === "expired" ? "expired" : "invalid",
			email: null,
		});
	}

	async update({ request, session, response }: HttpContext) {
		const { password } = await request.validateUsing(newPasswordValidator);
		const token = session.get(TOKEN_KEY);
		const user =
			typeof token === "string"
				? await this.accounts.resetPassword(token, password)
				: null;
		if (!user) return response.redirect().toRoute("password_reset.edit");
		session.forget(TOKEN_KEY);
		session.flash(
			"success",
			"Password changed. Sign in with your new password.",
		);
		return response.redirect().toRoute("session.create");
	}
}
