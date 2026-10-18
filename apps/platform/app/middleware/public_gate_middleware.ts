import type { HttpContext } from "@adonisjs/core/http";
import type { NextFn } from "@adonisjs/core/types/http";
import { callerOf } from "#services/api_caller";
import { consumeApiLimit } from "#services/api_limits";
import { isApiRequest, READ_METHODS } from "#services/public_api";

/**
 * The public API's first check (TAT-38), FIRST in router.use: after
 * routing (a URL no route matches never reaches it), before the body
 * parser, the session and shield. Works out the caller (server key and
 * visitor, #services/api_caller) and counts it, reads and writes apart, so
 * an address over its budget is refused before a byte of its body is read
 * and before the tenant lookup (TAT-32 ruling 16). Other requests pass.
 */
export default class PublicGateMiddleware {
	async handle(ctx: HttpContext, next: NextFn) {
		if (!isApiRequest(ctx)) return next();
		const caller = callerOf(ctx);
		const reads = READ_METHODS.has(ctx.request.method());
		await consumeApiLimit(reads ? "callerReads" : "callerWrites", caller);
		return next();
	}
}
