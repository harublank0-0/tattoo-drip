import { defineConfig } from "@adonisjs/cors";
import { browserOriginPolicy } from "#services/browser_origins";
import { isApiRequest } from "#services/public_api";
import { DEV_STOREFRONT_URL } from "#services/storefront_url";
import env from "#start/env";

/**
 * The browser origins the API answers (Discover D01): every studio page, the
 * dashboard and Discover, from the configured origins
 * (#services/browser_origins). An allowed origin is echoed back, and every
 * API answer carries Vary: Origin (#services/public_api); any other origin
 * gets no allow-origin header at all.
 */
const allowedOrigin = browserOriginPolicy({
	appUrl: env.get("APP_URL"),
	discoverUrl: env.get("DISCOVER_URL"),
	storefrontTemplate: env.get("STOREFRONT_URL") ?? DEV_STOREFRONT_URL,
});

/**
 * CORS for the public API only (TAT-32): the allowed browser origins above,
 * never credentials, the methods and request headers the SDK sends. The
 * dashboard is same-origin and answers no cross-origin request. A
 * server-side caller (the storefront's server, later Discover's) sends no
 * Origin and needs no CORS.
 *
 * https://docs.adonisjs.com/guides/security/cors
 */
const corsConfig = defineConfig({
	enabled: (ctx) => isApiRequest(ctx),

	origin: (requestOrigin) => allowedOrigin(requestOrigin),

	methods: ["GET", "HEAD", "POST"],

	/**
	 * JSON writes preflight for Content-Type, and the intake for its
	 * bot-challenge token (TAT-55), which rides in a header so the API checks
	 * it before it reads the upload. Authorization (the server key, TAT-38)
	 * is server-side only, so browsers may not send it.
	 */
	headers: ["accept", "content-type", "x-challenge-token"],

	/** So the studio page can say when to try again after a 429. */
	exposeHeaders: ["retry-after"],

	credentials: false,

	/** JSON writes and the intake preflight; a CORS fix reaches browsers in 10 minutes. */
	maxAge: 600,
});

export default corsConfig;
