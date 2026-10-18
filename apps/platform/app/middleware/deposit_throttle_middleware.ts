import type { HttpContext } from "@adonisjs/core/http";
import type { NextFn } from "@adonisjs/core/types/http";
import limiter from "@adonisjs/limiter/services/main";
import {
	DEPOSIT_LIMITS,
	depositLimitKeys,
} from "#modules/payments/deposit_limits";
import { callerIp } from "#services/api_caller";
import { READ_METHODS } from "#services/public_api";

/**
 * The deposit routes' rate limits (TAT-65). Every request to
 * /deposits/:token counts against its client address, then its token
 * (GET and HEAD as reads, anything else as a proof upload), 404s and
 * refusals included. Over either limit it throws E_TOO_MANY_REQUESTS, which
 * the API answers as 429 `rate_limited` with Retry-After. Runs after
 * publicTenant and before the handler reads the body (the body parser
 * reads no multipart body itself: multipart.autoProcess is false), so a
 * refused upload never reaches the disk. The counts live on the limiter's
 * own connection, so a request that fails later still counts. Counted by
 * the caller's address (`callerIp`: the storefront's visitor with a valid
 * server key, TAT-38).
 */
export default class DepositThrottleMiddleware {
	async handle(ctx: HttpContext, next: NextFn) {
		const action = READ_METHODS.has(ctx.request.method()) ? "read" : "submit";
		const limits = DEPOSIT_LIMITS[action];
		const keys = depositLimitKeys(
			action,
			callerIp(ctx),
			String(ctx.params.token),
		);
		// The address first, so a refused address never adds to the token's
		// count. multi() parses the durations in the objects it gets: copies.
		await limiter
			.multi([
				{ ...limits.perAddress, key: keys.perAddress },
				{ ...limits.perToken, key: keys.perToken },
			])
			.consume();
		return next();
	}
}
