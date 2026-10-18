/**
 * The dashboard's cookie policy (TAT-9). Studio pages run on subdomains of
 * the storefront's domain, and a studio can bring a domain of its own, so
 * no page but the dashboard's own host may ever read, set or overwrite its
 * session. In production the session cookie is `__Host-td-session`: the
 * prefix makes browsers refuse it unless it is Secure, on `/` and without
 * a Domain, so no other host can plant or replace it.
 *
 * Development and tests run over plain http (localhost, `*.localhost`, a
 * phone on the LAN), where browsers drop Secure and `__Host-` cookies, so
 * there the name is `td-session` and Secure is off; everything else is the
 * same everywhere. The switch is the environment (`app.inProduction`),
 * never the request: behind a TLS-terminating proxy the app sees http.
 * Pure: imports nothing.
 */

/** The session cookie's name without its production prefix. */
export const SESSION_COOKIE = "td-session";

/** The session cookie's name: `__Host-td-session` in production. */
export function sessionCookieName(production: boolean): string {
	return production ? `__Host-${SESSION_COOKIE}` : SESSION_COOKIE;
}

/**
 * The attributes of every cookie the app sets: `config/session.ts` gives
 * them to the session cookie and `config/app.ts` makes them the defaults of
 * every other cookie. Never add a `domain`: the cookie would reach every
 * subdomain, and in production the serializer refuses it for the `__Host-`
 * session cookie, so every request would fail.
 */
export function cookieAttributes(production: boolean) {
	return {
		path: "/",
		httpOnly: true,
		secure: production,
		sameSite: "lax",
	} as const;
}
