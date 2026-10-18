import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import type { NextFn } from "@adonisjs/core/types/http";
import { publicTenantContext } from "#middleware/public_tenant_middleware";
import { countIntake, intakeLimitKeys } from "#modules/inquiries/intake_limits";
import { storefrontTemplate } from "#modules/payments/deposit_links";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import BotChallenge, {
	CHALLENGE_ACTIONS,
	CHALLENGE_TOKEN_HEADER,
} from "#services/bot_challenge";
import { ApiException } from "#services/public_api_errors";
import { studioHostname } from "#services/storefront_url";

/**
 * The intake's checks before its multipart body is read (TAT-55), on
 * api.v1.inquiries.store after publicTenant: an unknown or old slug was
 * already the 404, so nothing here counts it or asks Cloudflare. Counts the
 * client address at this studio (429), asks Cloudflare about the
 * X-Challenge-Token header's token (403 challenge_failed, 503
 * challenge_unavailable; no call for a missing one), then counts the studio,
 * only for a passed challenge (429). The route reads its multipart body
 * itself (multipart.processManually), so a refusal here writes nothing to
 * disk. The global body parser still reads a JSON, urlencoded or text/*
 * body (1 MB at most) before any route middleware: such a request is
 * parsed first and then refused here or by the controller's 415 (TAT-32
 * ruling 6; TAT-38 bounds that). The honeypot and the phone count need the
 * body: the controller does them.
 */
@inject()
export default class IntakeGuardMiddleware {
	constructor(private challenge: BotChallenge) {}

	async handle(ctx: HttpContext, next: NextFn) {
		const { tenant } = publicTenantContext(ctx);
		const keys = intakeLimitKeys(tenant.id, ctx.request.ip());
		await countIntake("perAddress", keys.perAddress);

		const outcome = await this.challenge.verify(
			ctx.request.header(CHALLENGE_TOKEN_HEADER),
			{
				hostname: studioHostname(storefrontTemplate(), tenant.slug),
				action: CHALLENGE_ACTIONS.inquiry,
			},
		);
		if (outcome === "failed") throw ApiException.of("challenge_failed");
		if (outcome === "unavailable") {
			throw ApiException.of("challenge_unavailable");
		}

		await countIntake("perTenant", keys.perTenant);
		return next();
	}
}
