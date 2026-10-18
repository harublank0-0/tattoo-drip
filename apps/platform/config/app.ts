import { defineConfig } from "@adonisjs/core/http";
import app from "@adonisjs/core/services/app";
import { cookieAttributes } from "#services/cookie_policy";
import { onBadUrl } from "#services/public_api";
import env from "#start/env";

/**
 * The app URL can be used in various places where you want to create absolute
 * URLs to your application. For example, when sending emails, images should
 * use absolute URLs.
 */
export const appUrl = env.get("APP_URL");

/**
 * The trust function for a comma-separated TRUST_PROXY list (already
 * checked by #services/trust_proxy). The framework hands a string straight
 * to proxy-addr, which reads it as ONE entry, so a list is compiled entry by
 * entry and believed when any entry matches.
 */
export function trustedProxies(list: string) {
	const checks = list
		.split(",")
		.map((entry) => defineConfig({ trustProxy: entry.trim() }).trustProxy);
	return (address: string, hop: number) =>
		checks.some((trusts) => trusts(address, hop));
}

/**
 * The configuration settings used by the HTTP server
 */
export const http = defineConfig({
	/**
	 * Generate a unique request id for each incoming request.
	 * Useful to correlate logs and debug a request flow.
	 */
	generateRequestId: true,

	/**
	 * Allow HTTP method spoofing via the "_method" form/query parameter.
	 * This lets HTML forms target PUT/PATCH/DELETE routes while still
	 * submitting with POST.
	 */
	allowMethodSpoofing: false,

	/**
	 * The proxies whose X-Forwarded-For request.ip() believes (TRUST_PROXY,
	 * required in production; loopback in development and tests). Never
	 * every address: any client could then choose its own (TAT-38).
	 */
	trustProxy: trustedProxies(env.get("TRUST_PROXY") ?? "loopback"),

	/**
	 * Node drops a request whose whole body hasn't arrived within 120 s
	 * (its default is 300 s): the backstop behind the reverse proxy's
	 * timeouts and the uploads' own deadline (TAT-38).
	 */
	requestTimeout: 120_000,

	/**
	 * A URL that cannot be decoded is refused before any middleware runs;
	 * the public API (/api) answers it with its error envelope (TAT-32).
	 */
	onBadUrl,

	/**
	 * Enabling async local storage will let you access HTTP context
	 * from anywhere inside your application.
	 */
	useAsyncLocalStorage: false,

	router: {
		matcher: "tree",
	},

	/**
	 * Redirect configuration controls the behavior of
	 * response.redirect().back() and query string forwarding.
	 */
	redirect: {
		/**
		 * When enabled, all redirects automatically carry over the current
		 * request's query string parameters to the redirect destination.
		 * Use withQs(false) to opt out for a specific redirect.
		 */
		forwardQueryString: true,
	},

	/**
	 * Defaults for every cookie the app sets (TAT-9, #services/cookie_policy):
	 * host-only (never a Domain), on `/`, HttpOnly, SameSite=Lax, Secure in
	 * production. Shield's XSRF-TOKEN (made readable by the page), the auth
	 * guard's remember_web clearing and every clearCookie use them; the
	 * session cookie's own options are in config/session.ts.
	 */
	cookie: {
		...cookieAttributes(app.inProduction),
		maxAge: "2h",
	},
});
