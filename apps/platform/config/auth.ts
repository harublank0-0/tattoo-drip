import { defineConfig } from "@adonisjs/auth";
import { sessionGuard } from "@adonisjs/auth/session";
import type {
	Authenticators,
	InferAuthEvents,
	InferAuthenticators,
} from "@adonisjs/auth/types";
import { SessionVersionUserProvider } from "#modules/identity/session_user_provider";

const authConfig = defineConfig({
	/**
	 * Default guard used when no guard is explicitly specified.
	 */
	default: "web",

	guards: {
		/**
		 * Session-based guard for browser authentication.
		 */
		web: sessionGuard({
			/**
			 * Enable persistent login using remember-me tokens.
			 */
			useRememberMeTokens: false,

			/**
			 * The session stores the user's id with the account's session
			 * version, so a password reset signs every session out (TAT-18).
			 */
			provider: new SessionVersionUserProvider({
				model: () => import("#models/user"),
			}),
		}),
	},
});

export default authConfig;

/**
 * Inferring types from the configured auth
 * guards.
 */
declare module "@adonisjs/auth/types" {
	export interface Authenticators
		extends InferAuthenticators<typeof authConfig> {}
}
declare module "@adonisjs/core/types" {
	interface EventsList extends InferAuthEvents<Authenticators> {}
}
