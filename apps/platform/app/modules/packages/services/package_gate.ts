import { inject } from "@adonisjs/core";
import logger from "@adonisjs/core/services/logger";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ArtistService from "#modules/artists/services/artist_service";
import { type PackageRule, PackageRuleError } from "#modules/packages/errors";
import type { Capability } from "#modules/packages/route_capabilities";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import EntitlementService from "#modules/packages/services/entitlement_service";
import { packageEnforcement } from "#modules/packages/settings";
import type Tenant from "#modules/tenancy/models/tenant";
import { dbClient } from "#services/db_context";

type TenantRef = Pick<Tenant, "id">;

/**
 * Package rules (studio packages): each decision comes from the studio's
 * entitlement, computed now. In observe mode (the default) a refusal is
 * only logged ("Package rule would refuse") and the action goes ahead; in
 * enforce mode it throws PackageRuleError. Phase 3 adds its rules here.
 */
@inject()
export default class PackageGate {
	constructor(
		private entitlements: EntitlementService,
		private artists: ArtistService,
	) {}

	/**
	 * Before an artist becomes active (added, or restored from the archive):
	 * refused while paused, or when the active artists already fill the
	 * package's limit. Runs in the caller's studio context and transaction,
	 * and takes the studio's activation lock first (a transaction-level
	 * advisory lock), so two activations at once serialize and the count
	 * can't be read stale. Not a row lock on `tenants`: that would hold every
	 * foreign-key check of the studio's inserts (an inquiry, a payment) until
	 * the request ends, a photo upload included.
	 */
	async checkArtistActivation(tenant: TenantRef): Promise<void> {
		await dbClient().rawQuery(
			"select pg_advisory_xact_lock(hashtextextended(?, 0))",
			[`tattoo-drip:artist-activation:${tenant.id}`],
		);
		const entitlement = await this.entitlements.for(tenant);
		const active = await this.artists.countActive(tenant);
		const rule: PackageRule | null =
			entitlement.state === "paused"
				? "paused"
				: entitlement.artistLimit !== null && active >= entitlement.artistLimit
					? "artist_limit"
					: null;
		if (!rule) return;
		if (packageEnforcement() === "enforce") throw new PackageRuleError(rule);
		logger.info(
			{
				tenantId: tenant.id,
				rule,
				state: entitlement.state,
				package: entitlement.package,
				active,
				limit: entitlement.artistLimit,
			},
			"Package rule would refuse",
		);
	}

	/**
	 * Before a route the capability map restricts (route_capabilities,
	 * studio packages phase 3): `new_work` and `design_lab` are refused
	 * while the studio is paused. `open` and `artist_activation` (checked by
	 * checkArtistActivation in its controller) pass without reading the
	 * entitlement. Observe mode logs the refusal with its route and allows.
	 */
	async checkCapability(
		tenant: TenantRef,
		capability: Capability,
		route: string,
	): Promise<void> {
		if (capability === "open" || capability === "artist_activation") return;
		const entitlement = await this.entitlements.for(tenant);
		if (entitlement.state !== "paused") return;
		const rule: PackageRule =
			capability === "new_work" ? "paused_new_work" : "paused_design_lab";
		if (packageEnforcement() === "enforce") throw new PackageRuleError(rule);
		logger.info(
			{
				tenantId: tenant.id,
				rule,
				route,
				state: entitlement.state,
				package: entitlement.package,
			},
			"Package rule would refuse",
		);
	}

	/** The studio's active artists against its package's limit (null: any number). */
	async artistUsage(
		tenant: TenantRef,
	): Promise<{ active: number; limit: number | null }> {
		const [entitlement, active] = await Promise.all([
			this.entitlements.for(tenant),
			this.artists.countActive(tenant),
		]);
		return { active, limit: entitlement.artistLimit };
	}
}
