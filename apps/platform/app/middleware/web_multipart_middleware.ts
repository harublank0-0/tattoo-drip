import { Exception } from "@adonisjs/core/exceptions";
import type { HttpContext } from "@adonisjs/core/http";
import type { NextFn } from "@adonisjs/core/types/http";
import { isApiRequest } from "#services/public_api";
import { discardUploads, receiveUploads } from "#services/uploads";

/**
 * Reads the multipart body of a dashboard request (TAT-38 ruling 16). The
 * body parser reads no multipart body itself (config/bodyparser.ts): its
 * handler table is a plain object, and a file part named like an
 * Object.prototype property crashes the process. `receiveUploads` covers
 * those names. Last in router.use, after silent auth: a signed-out request
 * with a multipart body (nothing signed out takes files) is a 415 and its
 * body is never read; a signed-in one is read here, before any route
 * middleware opens a transaction, and every temp file it left goes at the
 * end of the request. The public API reads its own uploads after
 * publicTenant and its limits (receiveUploads in the handler).
 *
 * A multipart form sends its CSRF token in the X-XSRF-TOKEN header (Inertia
 * does): shield checks it before this reads the body.
 */
export default class WebMultipartMiddleware {
	async handle(ctx: HttpContext, next: NextFn) {
		if (isApiRequest(ctx) || ctx.request.bodyType !== "multipart") {
			return next();
		}
		if (!ctx.auth.isAuthenticated) {
			ctx.response.header("Connection", "close");
			throw new Exception("Sign in to send files", {
				status: 415,
				code: "E_UNSUPPORTED_MEDIA_TYPE",
			});
		}
		try {
			await receiveUploads(ctx.request);
			return await next();
		} finally {
			await discardUploads(ctx.request);
		}
	}
}
