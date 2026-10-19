import type { IncomingMessage, ServerResponse } from "node:http";
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
		const { request: incoming } = ctx.request;
		const { response } = ctx.response;
		const socket = incoming.socket;
		// The client may have hung up while the count above waited for the
		// database: its "close" is over, and a slot taken now would never be
		// freed (four of them stop every public write on this process). Nothing
		// to answer, nothing to count. No await from this check to the
		// listeners below: nothing can close in between.
		if (gone(incoming, response)) return;
		const slot = writeSlots.take(clientAddress(callerIp(ctx)));
		if (slot === "address") {
			throw ApiException.retryLater("rate_limited", RETRY_AFTER_BUSY_SECONDS);
		}
		if (slot === "process") {
			throw ApiException.retryLater("service_busy", RETRY_AFTER_BUSY_SECONDS);
		}
		// Freed when the response closes, or when the connection does: a
		// pipelined request still queued behind another one has no socket yet,
		// so its response never emits "close" (the request and its socket do).
		const release = () => {
			response.off("close", release);
			socket?.off("close", release);
			slot.release();
		};
		response.once("close", release);
		socket?.once("close", release);
		// Belt and braces: already gone after all (release is idempotent).
		if (gone(incoming, response)) release();
		return next();
	}
}

/**
 * Whether the client's connection is over: Node has emitted "close" on the
 * response already, or destroyed the request (a queued pipelined request is
 * destroyed with its connection but its response never closes).
 */
function gone(incoming: IncomingMessage, response: ServerResponse): boolean {
	return (
		response.destroyed ||
		response.closed ||
		incoming.destroyed ||
		incoming.socket?.destroyed === true
	);
}
