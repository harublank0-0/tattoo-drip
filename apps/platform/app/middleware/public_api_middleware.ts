import type { HttpContext } from "@adonisjs/core/http";
import type { NextFn } from "@adonisjs/core/types/http";
import { setApiHeaders } from "#services/public_api";

/**
 * The first middleware of every /api route (TAT-32; a test checks). The
 * session, CSRF, auth and Inertia middleware already skipped the request
 * (isApiRequest); this sets the headers every API response has, including
 * Cache-Control: no-store, which only the publicCache middleware lifts.
 * TAT-38 adds its rate limits right after it.
 */
export default class PublicApiMiddleware {
	handle(ctx: HttpContext, next: NextFn) {
		setApiHeaders(ctx.response);
		return next();
	}
}
