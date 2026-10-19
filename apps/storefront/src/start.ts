import { createCsrfMiddleware, createStart } from "@tanstack/react-start";
import { tenantMiddleware } from "./tenancy/middleware.ts";

/**
 * Declaring global request middleware replaces Start's default CSRF check on
 * server functions, so that check comes back first, exactly as Start's
 * default: a cross-site call is refused before any API lookup. Then every
 * server request resolves its studio from its host (TAT-12).
 */
const csrfMiddleware = createCsrfMiddleware({
	filter: (ctx) => ctx.handlerType === "serverFn",
});

export const startInstance = createStart(() => ({
	requestMiddleware: [csrfMiddleware, tenantMiddleware],
}));
