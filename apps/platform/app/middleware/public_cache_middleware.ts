import type { HttpContext } from "@adonisjs/core/http";
import type { NextFn } from "@adonisjs/core/types/http";
import {
	type PublicCacheOptions,
	publicCacheControl,
	READ_METHODS,
} from "#services/public_api";

/**
 * Makes a public read cacheable (TAT-32): a 200 GET or HEAD gets
 * `Cache-Control: public, max-age=60, stale-while-revalidate=600` (or the
 * seconds given) and a strong ETag, and a request whose If-None-Match still
 * matches gets a 304. Errors and other methods keep publicApi's no-store.
 * Opt-in per route (a test makes every API GET route decide). Never use it
 * on a response that isn't the same for everyone, such as a deposit page
 * (TAT-65).
 *
 *   router.get("/", [controllers.PublicStudio, "show"]).use(middleware.publicCache())
 */
export default class PublicCacheMiddleware {
	async handle(
		ctx: HttpContext,
		next: NextFn,
		options: PublicCacheOptions = {},
	) {
		await next();
		const content = ctx.response.content;
		if (
			!READ_METHODS.has(ctx.request.method()) ||
			ctx.response.getStatus() !== 200 ||
			!content
		) {
			return;
		}
		// Serialize before marking anything cacheable: the framework serializes
		// when it writes the response, and a failure there would send a plain
		// 500 that still carries the public headers. A throw here reaches the
		// exception handler instead (internal_error, no-store).
		const body = serialized(content[0]);
		ctx.response.header("Cache-Control", publicCacheControl(options));
		// The same body again, with an ETag: when Adonis writes it, a matching
		// If-None-Match becomes a 304.
		if (body === undefined) {
			ctx.response.send(content[0], true);
			return;
		}
		ctx.response.header("Content-Type", "application/json; charset=utf-8");
		ctx.response.send(body, true);
	}
}

/**
 * The JSON text of an object or array body (what the framework would send,
 * with bigints as strings like its own serializer; a circular body fails
 * rather than being cut short), or undefined for text, buffers and the rest.
 */
function serialized(content: unknown): string | undefined {
	if (
		typeof content !== "object" ||
		content === null ||
		content instanceof Uint8Array ||
		content instanceof Date ||
		content instanceof RegExp
	) {
		return undefined;
	}
	return JSON.stringify(content, (_key, value) =>
		typeof value === "bigint" ? value.toString() : value,
	);
}
