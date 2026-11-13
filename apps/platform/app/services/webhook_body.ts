import type { HttpContext } from "@adonisjs/core/http";

/** Where the payment webhooks arrive (start/routes.ts, api.v1.webhooks.*). */
export const WEBHOOK_PREFIX = "/api/v1/webhooks/";

/** The largest webhook body read; PayBridgeNP events are a few kilobytes. */
export const MAX_WEBHOOK_BYTES = 64 * 1024;

/** Whether the matched route is a payment webhook (judged on the route, never the raw URL alone). */
export function isWebhookRequest(ctx: HttpContext): boolean {
	const pattern = ctx.route?.pattern;
	return pattern?.startsWith(WEBHOOK_PREFIX) === true;
}

/**
 * The request's body exactly as sent, as UTF-8 text for the signature
 * check (the HMAC covers `<t>.<body>`), or null when it is larger than
 * MAX_WEBHOOK_BYTES. The body parser never ran on these routes
 * (BodyParserMiddleware), so the stream is untouched.
 */
export async function readRawBody(
	ctx: HttpContext,
	limit = MAX_WEBHOOK_BYTES,
): Promise<string | null> {
	const incoming = ctx.request.request;
	const declared = Number(incoming.headers["content-length"] ?? 0);
	if (declared > limit) return null;
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of incoming) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		size += buffer.length;
		if (size > limit) return null;
		chunks.push(buffer);
	}
	return Buffer.concat(chunks).toString("utf8");
}
