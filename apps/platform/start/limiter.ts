/*
|--------------------------------------------------------------------------
| Named HTTP limiters
|--------------------------------------------------------------------------
|
| Each counts every request to the routes it guards (TAT-8, TAT-18): per
| client address, per email address named, or per signed-in account. A
| refused request goes back to its form with "Too many attempts"
| (app/exceptions/handler.ts). The numbers live in AUTH_LIMITS. A key is
| `<name>_<digest>`, so the table holds no address.
|
*/

import type { HttpContext } from "@adonisjs/core/http";
import limiter from "@adonisjs/limiter/services/main";
import {
	AUTH_LIMITS,
	emailCountKey,
} from "#modules/identity/services/auth_limits";
import { clientAddress, digest } from "#services/rate_limits";

type Limit = { requests: number; duration: string };

/** Every request from one client address. */
function perAddress(ctx: HttpContext, limit: Limit) {
	return limiter
		.allowRequests(limit.requests)
		.every(limit.duration)
		.usingKey(digest(clientAddress(ctx.request.ip())));
}

/**
 * Every request naming one email address, registered or not (TAT-18),
 * counted per typed address (`+tags` and dots are different addresses). A
 * request that names none isn't counted here: validation refuses it, and
 * the client address's limit already counted it.
 */
function perEmail(ctx: HttpContext, limit: Limit) {
	const email = ctx.request.input("email");
	if (typeof email !== "string" || email.trim() === "") {
		return limiter.noLimit();
	}
	return limiter
		.allowRequests(limit.requests)
		.every(limit.duration)
		.usingKey(emailCountKey(email));
}

/**
 * Every request of the signed-in account from one client address (TAT-95); use
 * it after auth. The key is the digest of both, so an address spends only its
 * own count of the account.
 */
function perAccountAndAddress(ctx: HttpContext, limit: Limit) {
	return limiter
		.allowRequests(limit.requests)
		.every(limit.duration)
		.usingKey(
			digest(
				`${ctx.auth.getUserOrFail().id}:${clientAddress(ctx.request.ip())}`,
			),
		);
}

/** Every request of the signed-in account; use it after auth. */
function perAccount(ctx: HttpContext, limit: Limit) {
	return limiter
		.allowRequests(limit.requests)
		.every(limit.duration)
		.usingKey(digest(ctx.auth.getUserOrFail().id));
}

export const throttleSignup = limiter.define("signup", (ctx) =>
	perAddress(ctx, AUTH_LIMITS.signup),
);
export const throttleSignupEmail = limiter.define("signup_email", (ctx) =>
	perEmail(ctx, AUTH_LIMITS.signupPerEmail),
);
export const throttleResetRequest = limiter.define("reset_ip", (ctx) =>
	perAddress(ctx, AUTH_LIMITS.resetPerIp),
);
export const throttleResetEmail = limiter.define("reset_email", (ctx) =>
	perEmail(ctx, AUTH_LIMITS.resetPerEmail),
);
export const throttleAccountLinks = limiter.define("account_links", (ctx) =>
	perAddress(ctx, AUTH_LIMITS.accountLinksPerIp),
);
export const throttleVerifyCooldown = limiter.define("verify_cooldown", (ctx) =>
	perAccount(ctx, AUTH_LIMITS.verifyResendCooldown),
);
export const throttleVerifyResend = limiter.define("verify_resend", (ctx) =>
	perAccount(ctx, AUTH_LIMITS.verifyResendPerUser),
);
export const throttlePasswordChange = limiter.define("password_change", (ctx) =>
	perAccount(ctx, AUTH_LIMITS.passwordChangePerUser),
);
export const throttleSignOutOthers = limiter.define("sign_out_others", (ctx) =>
	perAccountAndAddress(ctx, AUTH_LIMITS.signOutOthersPerAddress),
);
export const throttleSignOutOthersAccount = limiter.define(
	"sign_out_others_account",
	(ctx) => perAccount(ctx, AUTH_LIMITS.signOutOthersPerUser),
);
