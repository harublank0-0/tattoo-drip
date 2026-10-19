import { defineConfig } from "@adonisjs/cors";
import { isApiRequest } from "#services/public_api";

/**
 * CORS for the public API only (TAT-32): any origin, never credentials, the
 * methods and request headers the SDK sends. The dashboard is same-origin
 * and answers no cross-origin request. The publicApi middleware also sends
 * Access-Control-Allow-Origin: * without an Origin header, for CDN copies.
 *
 * https://docs.adonisjs.com/guides/security/cors
 */
const corsConfig = defineConfig({
	enabled: (ctx) => isApiRequest(ctx),

	origin: "*",

	methods: ["GET", "HEAD", "POST"],

	/**
	 * JSON writes preflight for Content-Type. Authorization (the server key,
	 * TAT-38) is server-side only, so browsers may not send it.
	 */
	headers: ["accept", "content-type"],

	/** So the studio page can say when to try again after a 429. */
	exposeHeaders: ["retry-after"],

	credentials: false,

	/** Only JSON writes preflight; a CORS fix reaches browsers in 10 minutes. */
	maxAge: 600,
});

export default corsConfig;
