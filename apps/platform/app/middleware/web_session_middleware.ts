import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import type { NextFn } from "@adonisjs/core/types/http";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import SessionMiddleware from "@adonisjs/session/session_middleware";
import type { SessionStoreFactory } from "@adonisjs/session/types";
import { isApiRequest } from "#services/public_api";

/**
 * The session for every route but the public API, which is cookieless
 * (TAT-32): the session middleware sets its cookie on every request it
 * runs. In router.use in place of the package's middleware.
 */
@inject()
export default class WebSessionMiddleware {
	constructor(
		private session: SessionMiddleware<Record<string, SessionStoreFactory>>,
	) {}

	handle(ctx: HttpContext, next: NextFn) {
		return isApiRequest(ctx) ? next() : this.session.handle(ctx, next);
	}
}
