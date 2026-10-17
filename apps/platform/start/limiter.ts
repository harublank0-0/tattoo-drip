/*
|--------------------------------------------------------------------------
| Named HTTP limiters
|--------------------------------------------------------------------------
|
| Each counts every request to the routes it guards, per client address
| (TAT-8). A refused request goes back to its form with "Too many attempts"
| (app/exceptions/handler.ts). The numbers live in AUTH_LIMITS; password
| reset (TAT-18) adds its limiters here.
|
*/

import limiter from "@adonisjs/limiter/services/main";
import { AUTH_LIMITS } from "#modules/identity/services/auth_limits";
import { clientAddress, digest } from "#services/rate_limits";

export const throttleSignup = limiter.define("signup", (ctx) =>
	limiter
		.allowRequests(AUTH_LIMITS.signup.requests)
		.every(AUTH_LIMITS.signup.duration)
		.usingKey(digest(clientAddress(ctx.request.ip()))),
);
