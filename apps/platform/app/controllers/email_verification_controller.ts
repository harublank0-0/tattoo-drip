import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import {
	CONFIRMED_FLASH,
	SESSION_TOKEN_KEYS,
} from "#modules/identity/account_tokens";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import AccountService from "#modules/identity/services/account_service";

const TOKEN_KEY = SESSION_TOKEN_KEYS.verify_email;

/**
 * Email confirmation (TAT-18). The emailed link's GET only moves its token
 * into the session and opens /verify-email, whose URL holds no token;
 * confirming is that page's POST, so a mail scanner that opens links
 * changes nothing. Open to guests and to whoever is signed in: the link
 * proves the mailbox and signs nobody in. /confirm-email is the signed-in
 * account's own page: where verifiedEmail sends it, and "Send a new link".
 */
@inject()
export default class EmailVerificationController {
	constructor(private accounts: AccountService) {}

	async link({ params, session, response }: HttpContext) {
		session.put(TOKEN_KEY, params.token);
		response.header("Referrer-Policy", "no-referrer");
		response.header("Cache-Control", "no-store");
		return response.redirect().toRoute("email_verification.show");
	}

	async show({ session, auth, inertia, response }: HttpContext) {
		response.header("Cache-Control", "no-store");
		response.header("Referrer-Policy", "same-origin");
		const viewer = auth.user;
		const signedIn = {
			signedInEmail: viewer?.email ?? null,
			canResend: Boolean(viewer && !viewer.emailVerified),
		};

		const confirmed = session.flashMessages.get(CONFIRMED_FLASH);
		if (typeof confirmed === "string") {
			return inertia.render("auth/verify_email", {
				state: "done",
				email: confirmed,
				forSignedInUser: viewer?.email === confirmed,
				...signedIn,
				canResend: false,
			});
		}

		const token = session.get(TOKEN_KEY);
		const found =
			typeof token === "string"
				? await this.accounts.tokenState(token, "verify_email")
				: { state: "unknown" as const };
		if (found.state === "live") {
			return inertia.render("auth/verify_email", {
				state: "ready",
				email: found.email,
				forSignedInUser: viewer?.id === found.userId,
				...signedIn,
			});
		}
		return inertia.render("auth/verify_email", {
			state: found.state === "expired" ? "expired" : "invalid",
			email: null,
			forSignedInUser: false,
			...signedIn,
		});
	}

	async confirm({ session, response }: HttpContext) {
		const token = session.get(TOKEN_KEY);
		const user =
			typeof token === "string"
				? await this.accounts.confirmEmail(token)
				: null;
		if (user) {
			session.forget(TOKEN_KEY);
			session.flash(CONFIRMED_FLASH, user.email);
		}
		return response.redirect().toRoute("email_verification.show");
	}

	async notice({ auth, inertia, response }: HttpContext) {
		const user = auth.getUserOrFail();
		if (user.emailVerified) return response.redirect().toRoute("dashboard");
		return inertia.render("auth/confirm_email", { email: user.email });
	}

	async resend({ auth, session, response }: HttpContext) {
		const user = auth.getUserOrFail();
		if (user.emailVerified) return response.redirect().toRoute("dashboard");
		await this.accounts.sendVerification(user);
		session.flash("success", `We sent a new link to ${user.email}.`);
		return response.redirect().back();
	}
}
