import type { HttpContext } from "@adonisjs/core/http";
import type { NextFn } from "@adonisjs/core/types/http";
import { apiOnlyHosts } from "#services/platform_origins";
import { API_ERRORS, isApiRequest, setApiHeaders } from "#services/public_api";
import env from "#start/env";

/**
 * The hosts that serve the public API and nothing else (Discover D01): the
 * API's own host (API_URL, when it is not APP_URL's) and Discover's
 * (DISCOVER_URL, where the platform only ever sees the legacy /api proxy).
 * Empty in the live layout, so every host answers as before.
 */
const API_ONLY = apiOnlyHosts({
	appUrl: env.get("APP_URL"),
	apiUrl: env.get("API_URL"),
	discoverUrl: env.get("DISCOVER_URL"),
});

/**
 * First in the server stack, before static files, the session, Shield and
 * Inertia: on an API-only host, anything outside /api is the API's own 404
 * envelope. No dashboard page, sign-in form, static file or cookie is ever
 * served from the API's or Discover's host, so neither can hold a session or
 * a CSRF token (the reverse proxy refuses those paths too,
 * deploy/nginx/hosts.split.conf). The host is the request's hostname, which
 * honours X-Forwarded-Host only from a trusted proxy (TRUST_PROXY): nginx
 * sets it to the Host it routed on.
 */
export default class ApiHostMiddleware {
	handle(ctx: HttpContext, next: NextFn) {
		if (API_ONLY.size === 0 || isApiRequest(ctx)) return next();
		const host = ctx.request.hostname()?.toLowerCase().replace(/\.$/, "");
		if (!host || !API_ONLY.has(host)) return next();

		const { status, code, message } = API_ERRORS.not_found;
		setApiHeaders(ctx.response);
		ctx.response.status(status).json({ error: { code, message } });
	}
}
