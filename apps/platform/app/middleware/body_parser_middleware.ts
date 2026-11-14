import { inject } from "@adonisjs/core";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import CoreBodyParserMiddleware from "@adonisjs/core/bodyparser_middleware";
import type { HttpContext } from "@adonisjs/core/http";
import type { NextFn } from "@adonisjs/core/types/http";
import { isWebhookRequest } from "#services/webhook_body";

/**
 * The body parser for every route but the payment webhooks
 * (docs/payments-paybridgenp.md), whose signature covers the exact bytes
 * sent: their handler reads the raw body itself (#services/webhook_body),
 * so nothing parses, normalises or consumes it first. In router.use in
 * place of the package's middleware.
 */
@inject()
export default class BodyParserMiddleware {
	constructor(private parser: CoreBodyParserMiddleware) {}

	handle(ctx: HttpContext, next: NextFn) {
		return isWebhookRequest(ctx) ? next() : this.parser.handle(ctx, next);
	}
}
