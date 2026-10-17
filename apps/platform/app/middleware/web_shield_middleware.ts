import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import type { NextFn } from "@adonisjs/core/types/http";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ShieldMiddleware from "@adonisjs/shield/shield_middleware";
import { isApiRequest } from "#services/public_api";

/**
 * Shield (CSRF and security headers) for every route but the public API
 * (TAT-32). Its CSRF guard reads the session and sets the XSRF-TOKEN cookie
 * on every request, even for `exceptRoutes`, so the API skips it whole; the
 * API sets nosniff itself (setApiHeaders) and needs no CSRF token because
 * it has no cookies to forge with. In router.use in place of the package's
 * middleware.
 */
@inject()
export default class WebShieldMiddleware {
	constructor(private shield: ShieldMiddleware) {}

	handle(ctx: HttpContext, next: NextFn) {
		return isApiRequest(ctx) ? next() : this.shield.handle(ctx, next);
	}
}
