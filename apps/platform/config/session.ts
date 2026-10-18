import app from "@adonisjs/core/services/app";
import { defineConfig, stores } from "@adonisjs/session";
import { cookieAttributes, sessionCookieName } from "#services/cookie_policy";
import env from "#start/env";

const sessionConfig = defineConfig({
	/**
	 * Enable or disable session support globally.
	 */
	enabled: true,

	/**
	 * `__Host-td-session` in production, `td-session` in development and
	 * tests (TAT-9, #services/cookie_policy).
	 */
	cookieName: sessionCookieName(app.inProduction),

	/**
	 * When set to true, the session id cookie will be deleted
	 * once the user closes the browser.
	 */
	clearWithBrowser: false,

	/**
	 * Define how long to keep the session data alive without
	 * any activity.
	 */
	age: "2h",

	/**
	 * Host-only (never a Domain), on `/`, HttpOnly, SameSite=Lax, and Secure
	 * in production (#services/cookie_policy). The cookie store's data
	 * cookie, named by the session id, gets the same options.
	 */
	cookie: cookieAttributes(app.inProduction),

	/**
	 * The store to use. Make sure to validate the environment
	 * variable in order to infer the store name without any
	 * errors.
	 */
	store: env.get("SESSION_DRIVER"),

	/**
	 * List of configured stores. Refer documentation to see
	 * list of available stores and their config.
	 */
	stores: {
		/**
		 * Store session data inside encrypted cookies.
		 */
		cookie: stores.cookie(),

		/**
		 * Store session data inside the configured database.
		 */
		database: stores.database(),
	},
});

export default sessionConfig;
