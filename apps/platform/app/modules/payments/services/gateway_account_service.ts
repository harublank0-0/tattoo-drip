import { randomBytes } from "node:crypto";
import { inject } from "@adonisjs/core";
import logger from "@adonisjs/core/services/logger";
import type { TransactionClientContract } from "@adonisjs/lucid/types/database";
import { DateTime } from "luxon";
import ConnectionToVerifyMail from "#modules/notifications/emails/connection_to_verify_mail";
import { GatewayRuleError } from "#modules/payments/errors";
import GatewayAccount from "#modules/payments/models/gateway_account";
import type Tenant from "#modules/tenancy/models/tenant";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import TenancyService from "#modules/tenancy/services/tenancy_service";
import { withTransaction } from "#services/db_context";
import { sendMailInTransaction } from "#services/mail_in_transaction";
import PaymentProviders, {
	type GatewayApi,
	keyHint,
	modeOfKey,
	type ProviderAccount,
	ProviderError,
	SECRET_KEY_FORMAT,
	STUDIO_WEBHOOK_EVENTS,
} from "#services/paybridge";
import { openSecret, sealSecret } from "#services/secret_box";
import env from "#start/env";

type TenantRef = Pick<Tenant, "id">;

/** Whether online deposits run for a studio, and why not when they don't. */
export type GatewayAvailability =
	| { available: true; account: GatewayAccount }
	| {
			available: false;
			reason: "switched_off" | "not_connected" | "pending" | "suspended";
	  };

/** The path the studios' webhooks arrive at, before the key. */
export const STUDIO_WEBHOOK_PATH = "/api/v1/webhooks/paybridgenp/studios";

/**
 * A studio's connection to its own PayBridgeNP project
 * (docs/payments-paybridgenp.md, the merchant-account constraint). The
 * secret key is checked with the API, must be the platform's mode
 * (STUDIO_ONLINE_PAYMENTS) and must not be TattooDrip's own project or
 * merchant; the studio's webhook endpoint is registered with the studio's
 * key and its signing secret stored sealed. Payments run only once a
 * TattooDrip platform admin verified the connection.
 */
@inject()
export default class GatewayAccountService {
	constructor(
		private providers: PaymentProviders,
		private tenancy: TenancyService,
	) {}

	/** The platform's setting: disabled, sandbox or live. */
	mode() {
		return env.get("STUDIO_ONLINE_PAYMENTS");
	}

	/** The studio's live connection, or null. */
	async current(tenant: TenantRef): Promise<GatewayAccount | null> {
		return GatewayAccount.query()
			.where("tenant_id", tenant.id)
			.whereNull("disconnected_at")
			.first();
	}

	/** Whether the studio can take a deposit online right now. */
	async availability(tenant: TenantRef): Promise<GatewayAvailability> {
		const mode = this.mode();
		if (mode === "disabled")
			return { available: false, reason: "switched_off" };
		const account = await this.current(tenant);
		if (!account || account.livemode !== (mode === "live")) {
			return { available: false, reason: "not_connected" };
		}
		if (account.status === "pending")
			return { available: false, reason: "pending" };
		if (account.status === "suspended") {
			return { available: false, reason: "suspended" };
		}
		return { available: true, account };
	}

	/** The studio project's API, through its own (decrypted) key. */
	apiFor(account: GatewayAccount): GatewayApi {
		return this.providers.studio(
			openSecret(account.secretKeySealed, sealBinding(account)),
		);
	}

	/** The studio endpoint's signing secret, or null before it was registered. */
	webhookSecretFor(account: GatewayAccount): string | null {
		return account.webhookSecretSealed
			? openSecret(account.webhookSecretSealed, sealBinding(account))
			: null;
	}

	/**
	 * Connects the studio's own PayBridgeNP project. Replaces any previous
	 * connection (which stays on record, disconnected). The new connection
	 * waits for a platform admin's check before taking payments; each
	 * PLATFORM_ADMIN_EMAILS address is emailed in the same transaction
	 * (ALERT_EMAILS off sends none).
	 */
	async connect(
		tenant: TenantRef,
		userId: string,
		secretKey: string,
	): Promise<GatewayAccount> {
		const mode = this.mode();
		if (mode === "disabled") throw new GatewayRuleError("switched_off");
		const key = secretKey.trim();
		if (!SECRET_KEY_FORMAT.test(key)) throw new GatewayRuleError("key_format");
		if (modeOfKey(key) !== mode) throw new GatewayRuleError("key_mode");

		const api = this.providers.studio(key);
		const account = await checked(() => api.account());
		if (account.mode !== mode) throw new GatewayRuleError("key_mode");
		await this.assertNotPlatform(account);

		return withTransaction(async (trx) => {
			await lockGateway(trx, tenant.id);
			const previous = await this.current(tenant);
			if (previous) {
				await previous.merge({ disconnectedAt: DateTime.utc() }).save();
			}
			const webhookKey = randomBytes(24).toString("base64url");
			const row = new GatewayAccount();
			row.merge({
				tenantId: tenant.id,
				provider: "paybridgenp",
				livemode: mode === "live",
				keyHint: keyHint(key),
				webhookKey,
				providerMerchantId: account.merchantId.slice(0, 64),
				providerMerchantName: account.merchantName,
				providerProjectId: account.projectId.slice(0, 64),
				providerProjectName: account.projectName,
				status: "pending",
				connectedByUserId: userId,
			});
			row.secretKeySealed = sealSecret(key, sealBinding(row));
			const endpoint = await checked(() =>
				api.registerWebhook(
					webhookUrl(webhookKey),
					STUDIO_WEBHOOK_EVENTS,
					`td-gateway-webhook-${webhookKey}`,
				),
			);
			row.providerWebhookId = endpoint.id.slice(0, 64);
			row.webhookSecretSealed = sealSecret(endpoint.secret, sealBinding(row));
			await row.save();
			await this.tellAdmins(trx, tenant, row);
			logger.info(
				{ tenantId: tenant.id, accountId: row.id, mode },
				"Studio payment connection added; waiting for a platform admin's check",
			);
			return row;
		});
	}

	/** Emails each platform admin that `account` waits for their check. */
	private async tellAdmins(
		trx: TransactionClientContract,
		tenant: TenantRef,
		account: GatewayAccount,
	): Promise<void> {
		if (env.get("ALERT_EMAILS") === false) return;
		const admins = env.get("PLATFORM_ADMIN_EMAILS");
		if (admins.length === 0) return;
		const studio = await this.tenancy.find(tenant.id);
		if (!studio) return;
		const url = new URL("/admin/payments", env.get("APP_URL")).toString();
		for (const to of admins) {
			await sendMailInTransaction(
				new ConnectionToVerifyMail({
					to,
					studioName: studio.name,
					merchantName: account.providerMerchantName,
					projectName: account.providerProjectName,
					mode: account.livemode ? "live" : "sandbox",
					url,
				}),
				trx,
			);
		}
	}

	/** Stops online deposits for the studio; the connection stays on record. */
	async disconnect(tenant: TenantRef): Promise<void> {
		await withTransaction(async (trx) => {
			await lockGateway(trx, tenant.id);
			const account = await this.current(tenant);
			if (!account) return;
			await account.merge({ disconnectedAt: DateTime.utc() }).save();
		});
	}

	/** A platform admin's decision on a pending or suspended connection. */
	async review(
		tenant: TenantRef,
		accountId: string,
		adminUserId: string,
		decision: "verify" | "suspend",
	): Promise<GatewayAccount> {
		return withTransaction(async (trx) => {
			await lockGateway(trx, tenant.id);
			const account = await GatewayAccount.query()
				.where("tenant_id", tenant.id)
				.where("id", accountId)
				.whereNull("disconnected_at")
				.firstOrFail();
			if (decision === "verify") {
				account.merge({
					status: "verified",
					verifiedAt: DateTime.utc(),
					verifiedByUserId: adminUserId,
				});
			} else {
				account.merge({
					status: "suspended",
					verifiedAt: null,
					verifiedByUserId: adminUserId,
				});
			}
			return account.save();
		});
	}

	/**
	 * Refuses TattooDrip's own project or merchant: a studio's client money
	 * must never settle to TattooDrip's provider accounts.
	 */
	private async assertNotPlatform(account: ProviderAccount) {
		const platform = this.providers.platform();
		if (!platform) return;
		const own = await checked(() => platform.account());
		if (
			own.projectId === account.projectId ||
			own.merchantId === account.merchantId
		) {
			throw new GatewayRuleError("platform_account");
		}
	}
}

/** What a sealed secret is bound to: its studio and webhook key (both fixed for the row's life). */
function sealBinding(account: Pick<GatewayAccount, "tenantId" | "webhookKey">) {
	return `gateway:${account.tenantId}:${account.webhookKey}`;
}

/** The studio endpoint's URL on the API's origin. */
export function webhookUrl(webhookKey: string): string {
	const origin = new URL(env.get("API_URL") ?? env.get("APP_URL")).origin;
	return `${origin}${STUDIO_WEBHOOK_PATH}/${webhookKey}`;
}

async function lockGateway(trx: TransactionClientContract, tenantId: string) {
	await trx.rawQuery("select pg_advisory_xact_lock(hashtextextended(?, 0))", [
		`gateway:${tenantId}`,
	]);
}

/** A provider call during connecting, its failure in the owner's words. */
async function checked<T>(call: () => Promise<T>): Promise<T> {
	try {
		return await call();
	} catch (error) {
		if (!(error instanceof ProviderError)) throw error;
		if (error.kind === "auth") throw new GatewayRuleError("key_rejected");
		if (error.kind === "permission") throw new GatewayRuleError("key_scope");
		throw new GatewayRuleError("provider_unavailable");
	}
}
