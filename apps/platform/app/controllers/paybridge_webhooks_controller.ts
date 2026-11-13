import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import logger from "@adonisjs/core/services/logger";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import BillingService from "#modules/billing/services/billing_service";
import GatewayAccount from "#modules/payments/models/gateway_account";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import GatewayAccountService from "#modules/payments/services/gateway_account_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import GatewayCheckoutService from "#modules/payments/services/gateway_checkout_service";
import { dbClient, withDbContext } from "#services/db_context";
import PaymentProviders, {
	ProviderError,
	type ProviderEvent,
} from "#services/paybridge";
import { ApiException } from "#services/public_api_errors";
import { readRawBody } from "#services/webhook_body";

/** The header PayBridgeNP signs every delivery with (lower case, as Node gives it). */
export const SIGNATURE_HEADER = "x-paybridgenp-signature";

const tooLarge = () => ApiException.of("payload_too_large");
const badSignature = () =>
	new ApiException(
		400,
		"invalid_signature",
		"The signature could not be verified.",
	);

/**
 * PayBridgeNP's webhooks (docs/payments-paybridgenp.md). Each delivery's
 * raw body (the body parser skips these routes) is checked with the SDK's
 * constructEvent and the right secret before anything in it is read: the
 * platform's own secret for TattooDrip billing, the studio connection's own
 * secret for a studio's payments. A bad signature or a stale timestamp is
 * a 400; an event is then processed once, by its id, and the objects it
 * names are read back from the API. A 2xx tells PayBridgeNP to stop; a
 * failure answers 500 so it retries (30 s, 5 min, 30 min, 2 h, 8 h).
 * Logs carry ids and types only, never a body or a secret.
 */
@inject()
export default class PaybridgeWebhooksController {
	constructor(
		private providers: PaymentProviders,
		private billing: BillingService,
		private accounts: GatewayAccountService,
		private checkouts: GatewayCheckoutService,
	) {}

	/** TattooDrip's own billing project. */
	async platform(ctx: HttpContext) {
		const secret = this.providers.platformWebhookSecret();
		const api = this.providers.platform();
		if (!secret || !api) throw ApiException.notFound();
		const body = await readRawBody(ctx);
		if (body === null) throw tooLarge();
		const event = await this.verify(body, ctx, secret);
		const log = { eventId: event.id, type: event.type, scope: "platform" };
		if (event.livemode !== (api.mode === "live")) {
			logger.warn(log, "PayBridgeNP event of the other mode ignored");
			return { received: true };
		}
		const tenantId = await this.billing.tenantForEvent(event);
		if (!tenantId) {
			logger.info(log, "PayBridgeNP event about no studio ignored");
			return { received: true };
		}
		const result = await this.billing.handleEvent(tenantId, event);
		logger.info({ ...log, tenantId, result }, "PayBridgeNP billing event");
		return { received: true };
	}

	/** One studio's own project, by the random key in its webhook URL. */
	async studio(ctx: HttpContext) {
		const key = String(ctx.params.key);
		const { rows } = await dbClient().rawQuery(
			"select public.gateway_tenant_for_webhook(?) as tenant_id",
			[key],
		);
		const tenantId = rows[0]?.tenant_id as string | null;
		if (!tenantId) throw ApiException.notFound();
		const body = await readRawBody(ctx);
		if (body === null) throw tooLarge();
		return withDbContext({ tenantId }, async () => {
			const account = await GatewayAccount.query()
				.where("tenant_id", tenantId)
				.where("webhook_key", key)
				.first();
			const secret = account ? this.accounts.webhookSecretFor(account) : null;
			if (!account || !secret) throw ApiException.notFound();
			const event = await this.verify(body, ctx, secret);
			const result = await this.checkouts.handleEvent(account, event);
			logger.info(
				{
					eventId: event.id,
					type: event.type,
					scope: "studio",
					tenantId,
					accountId: account.id,
					result,
				},
				"PayBridgeNP studio event",
			);
			return { received: true };
		});
	}

	private async verify(
		body: string,
		ctx: HttpContext,
		secret: string,
	): Promise<ProviderEvent> {
		const header = ctx.request.header(SIGNATURE_HEADER) ?? null;
		try {
			return await this.providers.verifyEvent(body, header, secret);
		} catch (error) {
			if (error instanceof ProviderError && error.kind === "signature") {
				logger.warn(
					{ route: ctx.route?.name },
					"PayBridgeNP webhook refused: bad signature or timestamp",
				);
				throw badSignature();
			}
			throw error;
		}
	}
}
