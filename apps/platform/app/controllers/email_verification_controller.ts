import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import router from "@adonisjs/core/services/router";
import {
	CONFIRMED_FLASH,
	FLOW_FIELD,
	SESSION_TOKEN_KEYS,
} from "#modules/identity/account_tokens";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import AccountService from "#modules/identity/services/account_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import TenancyService from "#modules/tenancy/services/tenancy_service";

const TOKEN_KEY = SESSION_TOKEN_KEYS.verify_email;

/** The path of a Referer header, or null: only compared with a named route, never followed. */
function refererPath(value: string | undefined) {
	if (!value) return null;
	try {
		return new URL(value, "http://localhost").pathname;
	} catch {
		return null;
	}
}

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
	constructor(
		private accounts: AccountService,
		private tenancy: TenancyService,
	) {}

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
				flow: null,
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
				flow: found.flow,
				forSignedInUser: viewer?.id === found.userId,
				...signedIn,
			});
		}
		return inertia.render("auth/verify_email", {
			state: found.state === "expired" ? "expired" : "invalid",
			email: null,
			flow: null,
			forSignedInUser: false,
			...signedIn,
		});
	}

	async confirm({ request, session, response }: HttpContext) {
		const token = session.get(TOKEN_KEY);
		// The page's hidden field: the link it showed, not whichever was staged since.
		const flow = request.input(FLOW_FIELD);
		const user =
			typeof token === "string" && typeof flow === "string"
				? await this.accounts.confirmEmail(token, flow)
				: null;
		if (user) {
			session.forget(TOKEN_KEY);
			session.flash(CONFIRMED_FLASH, user.email);
		}
		return response.redirect().toRoute("email_verification.show");
	}

	/**
	 * An existing member of a studio can land here too (any unconfirmed
	 * account that opens /onboarding): `hasStudio` swaps "then you can set up
	 * your studio" for a way back to it.
	 */
	async notice({ auth, inertia, response }: HttpContext) {
		const user = auth.getUserOrFail();
		if (user.emailVerified) return response.redirect().toRoute("dashboard");
		return inertia.render("auth/confirm_email", {
			email: user.email,
			hasStudio: await this.tenancy.hasTenant(user),
		});
	}

	/**
	 * From the dead-link page, back() would show the same dead link again, so
	 * that visitor goes to the notice page. Everyone else (the banner, the
	 * notice) goes back. The target is always a named route or back(): the
	 * Referer is only compared with /verify-email, never followed.
	 */
	async resend({ auth, request, session, response }: HttpContext) {
		const user = auth.getUserOrFail();
		if (user.emailVerified) return response.redirect().toRoute("dashboard");
		await this.accounts.sendVerification(user);
		session.flash("success", `We sent a new link to ${user.email}.`);
		if (
			refererPath(request.header("referer")) ===
			router.makeUrl("email_verification.show")
		) {
			return response.redirect().toRoute("email_verification.notice");
		}
		return response.redirect().back();
	}
}
