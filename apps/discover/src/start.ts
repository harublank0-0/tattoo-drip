import { createMiddleware, createStart } from "@tanstack/react-start";
import { SECURITY_HEADERS } from "./lib/headers.ts";

/**
 * D10: the security headers (src/lib/headers.ts) on every response Start
 * makes, whatever its status: pages, 404 and error pages, redirects and the
 * server routes. Static files get them from Nitro's route rules
 * (vite.config.ts), which don't reach a response Start builds itself.
 */
const securityHeaders = createMiddleware().server(async ({ next }) => {
	const result = await next();
	for (const [name, value] of Object.entries(SECURITY_HEADERS))
		result.response.headers.set(name, value);
	return result;
});

export const startInstance = createStart(() => ({
	requestMiddleware: [securityHeaders],
}));
