import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { publicTenantContext } from "#middleware/public_tenant_middleware";
import { InvalidImageError } from "#modules/media/errors";
import {
	DepositPageNotFoundError,
	DepositProofError,
	GatewayRuleError,
} from "#modules/payments/errors";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import DepositPageService from "#modules/payments/services/deposit_page_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import GatewayCheckoutService from "#modules/payments/services/gateway_checkout_service";
import {
	depositProofValidator,
	METHOD_MESSAGE,
} from "#modules/payments/validators/deposit_proof";
import { ApiException, apiErrorFor } from "#services/public_api_errors";
import { discardUploads, receiveUploads } from "#services/uploads";
import PublicDepositTransformer from "#transformers/public_deposit_transformer";

/**
 * The public deposit page (getDeposit and submitDepositProof in
 * openapi.yaml, TAT-65): a project's deposit through its link's token, and
 * the client's payment screenshot. Every link that doesn't work is the same
 * 404, before anything else is looked at; the upload's body is read only
 * after that (the body parser reads no multipart body itself:
 * multipart.autoProcess is false).
 */
@inject()
export default class PublicDepositsController {
	constructor(
		private pages: DepositPageService,
		private online: GatewayCheckoutService,
	) {}

	async show(ctx: HttpContext) {
		const { tenant } = publicTenantContext(ctx);
		try {
			const page = await this.pages.show(tenant, ctx.params.token);
			const online = await this.online.onlineState(tenant, page);
			return await ctx.serialize(
				PublicDepositTransformer.transform({ ...page, online }),
			);
		} catch (error) {
			throw toApiError(error);
		}
	}

	/**
	 * startDepositCheckout: a hosted checkout for the deposit still due. The
	 * body is ignored: the amount is the API's own. When PayBridgeNP doesn't
	 * answer, the 503 is sent without throwing, so the request's transaction
	 * still commits the attempt and its idempotency key for the next try.
	 */
	async checkout(ctx: HttpContext) {
		const { tenant } = publicTenantContext(ctx);
		try {
			const started = await this.online.startDeposit(tenant, ctx.params.token);
			ctx.response.status(201);
			return { data: { checkoutUrl: started.checkoutUrl } };
		} catch (error) {
			if (error instanceof DepositPageNotFoundError)
				throw ApiException.notFound();
			if (!(error instanceof GatewayRuleError)) throw error;
			if (error.reason === "provider_unavailable") {
				const { status, body, headers } = apiErrorFor(
					ApiException.of("payment_provider_unavailable"),
				);
				for (const [name, value] of Object.entries(headers)) {
					ctx.response.header(name, value);
				}
				return ctx.response.status(status).send(body);
			}
			throw ApiException.of("online_payment_unavailable");
		}
	}

	async store(ctx: HttpContext) {
		const { request, response } = ctx;
		const { tenant } = publicTenantContext(ctx);
		try {
			// A dead link is the 404 whatever the body says.
			await this.pages.show(tenant, ctx.params.token);
			if (request.bodyType !== "multipart") {
				throw ApiException.of("unsupported_media_type");
			}
			// The tenant, the limits and the link are checked, so only now does
			// the body go to disk (413 or 400 if it can't be read).
			await receiveUploads(request);
			const submission = await request.validateUsing(depositProofValidator, {
				// Only the first `proof` part is read; discardUploads drops the rest.
				data: { ...request.all(), proof: request.file("proof") ?? undefined },
			});
			const page = await this.pages.submitProof(
				tenant,
				ctx.params.token,
				submission,
			);
			response.status(201);
			const online = await this.online.onlineState(tenant, page);
			return await ctx.serialize(
				PublicDepositTransformer.transform({ ...page, online }),
			);
		} catch (error) {
			throw toApiError(error);
		} finally {
			await discardUploads(request);
		}
	}
}

/** The deposit page's refusals as the API answers them; any other error as it is. */
function toApiError(error: unknown) {
	if (error instanceof DepositPageNotFoundError) return ApiException.notFound();
	if (error instanceof InvalidImageError) {
		return ApiException.of("validation_failed", { proof: [error.message] });
	}
	if (!(error instanceof DepositProofError)) return error;
	switch (error.reason) {
		case "not_due":
			return ApiException.of("deposit_not_due");
		case "amount_changed":
			return ApiException.of("deposit_changed");
		case "method_unavailable":
			return ApiException.of("validation_failed", { method: [METHOD_MESSAGE] });
		default:
			return error;
	}
}
