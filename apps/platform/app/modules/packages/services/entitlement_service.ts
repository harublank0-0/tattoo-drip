import { inject } from "@adonisjs/core";
import { DateTime } from "luxon";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import BillingService from "#modules/billing/services/billing_service";
import { bundleIdsByKey } from "#modules/packages/bundles";
import {
	type Entitlement,
	resolveEntitlement,
} from "#modules/packages/entitlement";
import { PACKAGES, packageForTenantType } from "#modules/packages/packages";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import PilotGrantService from "#modules/packages/services/pilot_grant_service";
import type Tenant from "#modules/tenancy/models/tenant";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import TenancyService from "#modules/tenancy/services/tenancy_service";

/**
 * A paid period with no plan on record was bought before plans recorded
 * their package; the only plans then were Studio's, at this bundle
 * (docs/superpowers/specs/2026-11-15-studio-packages-design.md, calls).
 */
const LEGACY_BUNDLE_KEY = "studio-v1";

/**
 * What a studio may do now (studio packages, the single source of truth):
 * its paid coverage in the active billing mode, its pilot grants and its
 * trial, resolved by `resolveEntitlement`. Computed on every call, never
 * stored. Reads run in the caller's context, which must be the studio's.
 */
@inject()
export default class EntitlementService {
	constructor(
		private billing: BillingService,
		private tenancy: TenancyService,
		private pilots: PilotGrantService,
	) {}

	/**
	 * Bundle ids by key, read once per service instance: bundles never change
	 * (`allowance_bundles_guard`), so a loop over studios reads them once.
	 */
	private knownBundles = new Map<string, string>();

	private async bundleIds(keys: string[]): Promise<Map<string, string>> {
		const missing = keys.filter((key) => !this.knownBundles.has(key));
		if (missing.length > 0) {
			for (const [key, id] of await bundleIdsByKey(missing)) {
				this.knownBundles.set(key, id);
			}
		}
		return this.knownBundles;
	}

	/** The studio's entitlement, reading the studio first. */
	async for(
		tenant: Pick<Tenant, "id">,
		at: DateTime = DateTime.utc(),
	): Promise<Entitlement> {
		const studio = await this.tenancy.find(tenant.id);
		if (!studio) {
			throw new Error(
				"EntitlementService.for: the studio isn't visible in this context",
			);
		}
		return this.forLoaded(studio, at);
	}

	/**
	 * The same for a studio the caller has just loaded in this context (the
	 * admin page's loop), without reading it again.
	 */
	async forLoaded(
		studio: Pick<Tenant, "id" | "createdAt" | "type" | "selectedPackage">,
		at: DateTime = DateTime.utc(),
	): Promise<Entitlement> {
		const coverage = await this.billing.paidCoverage(studio);
		const grants = await this.pilots.forTenant(studio);
		// No choice on record (a workspace from before, a fixture): the type's
		// suggestion, as at signup.
		const trialPackage =
			studio.selectedPackage ?? packageForTenantType(studio.type);
		const trialBundleKey = PACKAGES[trialPackage].defaultBundleKey;
		const bundles = await this.bundleIds([trialBundleKey, LEGACY_BUNDLE_KEY]);
		const legacyBundle = bundles.get(LEGACY_BUNDLE_KEY) as string;

		return resolveEntitlement({
			at,
			workspaceCreatedAt: studio.createdAt,
			trial: {
				package: trialPackage,
				bundleId: bundles.get(trialBundleKey) as string,
			},
			pilots: grants.map((grant) => ({
				startsAt: grant.startsAt,
				endsAt: grant.endsAt,
				package: grant.package,
				bundleId: grant.allowanceBundleId,
			})),
			periods: coverage.map((period) => ({
				startsAt: period.startsAt,
				endsAt: period.endsAt,
				revokedAt: period.revokedAt,
				package: period.package ?? "studio",
				bundleId: period.allowanceBundleId ?? legacyBundle,
			})),
		});
	}
}
