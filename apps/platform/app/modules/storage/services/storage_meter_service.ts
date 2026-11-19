import { inject } from "@adonisjs/core";
import { DateTime } from "luxon";
import type { ImagePurpose } from "#modules/media/services/image_service";
import AllowanceBundle from "#modules/packages/models/allowance_bundle";
import { PACKAGES, type PackageKey } from "#modules/packages/packages";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import EntitlementService from "#modules/packages/services/entitlement_service";
import {
	formatBytes,
	STORAGE_CATEGORIES,
	STORAGE_CATEGORY,
	type StorageCategory,
} from "#modules/storage/categories";
import { liveKeysCte } from "#modules/storage/live_keys";
import type Tenant from "#modules/tenancy/models/tenant";
import { dbClient } from "#services/db_context";

type TenantRef = Pick<Tenant, "id">;

const MB = 1048576;

/** A Studio studio's storage as it would be on Solo (`downgradePreview`). */
export type DowngradePreview = {
	usedText: string;
	soloText: string;
	/** How far over Solo's allowance; null when it fits. */
	overText: string | null;
};

export type StorageUsage = {
	/** Stored files a live record holds, plus unexpired reservations. */
	usedBytes: number;
	byCategory: Record<StorageCategory, number>;
	/** The allowance in force; null when the bundle isn't metered. */
	limitBytes: number | null;
};

/**
 * The storage meter (docs/superpowers/specs/2026-11-16-storage-meter-design.md):
 * each studio's usage against its package allowance. Reads run in the
 * studio's context.
 */
@inject()
export default class StorageMeterService {
	constructor(private entitlements: EntitlementService) {}

	/**
	 * The studio's allowance in bytes from its entitlement's bundle; null when
	 * the bundle isn't metered. A v1 bundle (made before storage was metered)
	 * reads its package's launch default, the v2 bundle's number.
	 */
	async limitBytes(
		tenant: TenantRef,
		now: DateTime = DateTime.utc(),
	): Promise<number | null> {
		const entitlement = await this.entitlements.for(tenant, now);
		const bundle = await AllowanceBundle.find(entitlement.bundleId);
		if (!bundle) return null;
		let megabytes = bundle.storageMegabytes;
		if (megabytes === null && bundle.key === `${bundle.package}-v1`) {
			const launch = await AllowanceBundle.findBy(
				"key",
				PACKAGES[bundle.package].defaultBundleKey,
			);
			megabytes = launch?.storageMegabytes ?? null;
		}
		return megabytes === null ? null : megabytes * MB;
	}

	/**
	 * Studio's allowance in bytes when moving to Studio would give this Solo
	 * studio more room than `limitBytes`; null otherwise (already on Studio,
	 * or Studio's bundle unmetered). Only a refusal asks.
	 */
	async studioOfferBytes(
		tenant: TenantRef,
		limitBytes: number,
		now: DateTime = DateTime.utc(),
	): Promise<number | null> {
		const entitlement = await this.entitlements.for(tenant, now);
		if (entitlement.package !== "solo") return null;
		const studio = await AllowanceBundle.findBy(
			"key",
			PACKAGES.studio.defaultBundleKey,
		);
		const megabytes = studio?.storageMegabytes ?? null;
		const offered = megabytes === null ? null : megabytes * MB;
		return offered !== null && offered > limitBytes ? offered : null;
	}

	/**
	 * The downgrade preview (step 4): a Studio studio's usage (`usage`, as
	 * Billing read it) against Solo's allowance, and how far over it is;
	 * null for a studio already on Solo or when Solo's bundle isn't metered.
	 * Phase 4's downgrade screen shows it before the owner confirms; nothing
	 * is deleted at renewal, uploads just pause while it's over.
	 */
	async downgradePreview(
		usage: StorageUsage,
		current: PackageKey,
	): Promise<DowngradePreview | null> {
		if (current !== "studio") return null;
		const solo = await AllowanceBundle.findBy(
			"key",
			PACKAGES.solo.defaultBundleKey,
		);
		if (!solo || solo.storageMegabytes === null) return null;
		const soloBytes = solo.storageMegabytes * MB;
		return {
			usedText: formatBytes(usage.usedBytes),
			soloText: formatBytes(soloBytes),
			overText:
				usage.usedBytes > soloBytes
					? formatBytes(usage.usedBytes - soloBytes)
					: null,
		};
	}

	/** The studio's usage now, by category, with its allowance. */
	async usage(
		tenant: TenantRef,
		now: DateTime = DateTime.utc(),
	): Promise<StorageUsage> {
		// A join on the distinct live keys (a semi-join under an OR would be a
		// per-row subplan), plus the reservations still running.
		const { rows } = (await dbClient().rawQuery(
			`${liveKeysCte}
			 select purpose, sum(bytes)::text as bytes from (
			   select f.purpose, f.bytes
			   from stored_files f
			   join (select distinct key from live) l on l.key = f.key, t
			   where f.tenant_id = t.id and f.status = 'stored'
			   union all
			   select f.purpose, f.bytes
			   from stored_files f, t
			   where f.tenant_id = t.id and f.status = 'reserved' and f.expires_at > ?
			 ) counted
			 group by purpose`,
			[tenant.id, now.toJSDate()],
		)) as { rows: { purpose: ImagePurpose; bytes: string }[] };
		const byCategory = Object.fromEntries(
			STORAGE_CATEGORIES.map((category) => [category, 0]),
		) as Record<StorageCategory, number>;
		for (const row of rows) {
			const category = STORAGE_CATEGORY[row.purpose];
			if (category) byCategory[category] += Number(row.bytes);
		}
		return {
			usedBytes: STORAGE_CATEGORIES.reduce(
				(total, category) => total + byCategory[category],
				0,
			),
			byCategory,
			limitBytes: await this.limitBytes(tenant, now),
		};
	}
}
