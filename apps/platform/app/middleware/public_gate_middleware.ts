import type { HttpContext } from "@adonisjs/core/http";
import type { NextFn } from "@adonisjs/core/types/http";
import { callerIp, callerOf } from "#services/api_caller";
import { consumeApiLimit } from "#services/api_limits";
import {
	isApiRequest,
	READ_METHODS,
	RETRY_AFTER_BUSY_SECONDS,
} from "#services/public_api";
import { ApiException } from "#services/public_api_errors";
import { clientAddress } from "#services/rate_limits";
import { writeSlots } from "#services/write_slots";

/**
 * The public API's first check (TAT-38), FIRST in router.use: after
 * routing (a URL no route matches never reaches it), before the body
 * parser, the session and shield. Works out the caller (server key and
 * visitor, #services/api_caller) and counts it, reads and writes apart, so
 * an address over its budget is refused before a byte of its body is read
 * and before the tenant lookup (TAT-32 ruling 16). A write then takes one of
 * the process's write slots (#services/write_slots) until its response
 * closes. Other requests pass.
 */
export default class PublicGateMiddleware {
	async handle(ctx: HttpContext, next: NextFn) {
		if (!isApiRequest(ctx)) return next();
		const caller = callerOf(ctx);
		const reads = READ_METHODS.has(ctx.request.method());
		await consumeApiLimit(reads ? "callerReads" : "callerWrites", caller);
		if (reads) return next();
		// Writes in flight: a slot until the response closes (TAT-38 ruling 13).
		const slot = writeSlots.take(clientAddress(callerIp(ctx)));
		if (slot === "address") {
			throw ApiException.retryLater("rate_limited", RETRY_AFTER_BUSY_SECONDS);
		}
		if (slot === "process") {
			throw ApiException.retryLater("service_busy", RETRY_AFTER_BUSY_SECONDS);
		}
		ctx.response.response.once("close", slot.release);
		return next();
	}
}
