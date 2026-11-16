import { inject } from "@adonisjs/core";
import { DateTime } from "luxon";
import type { ImagePurpose } from "#modules/media/services/image_service";
import AllowanceBundle from "#modules/packages/models/allowance_bundle";
import { PACKAGES } from "#modules/packages/packages";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import EntitlementService from "#modules/packages/services/entitlement_service";
import {
	STORAGE_CATEGORIES,
	STORAGE_CATEGORY,
	type StorageCategory,
} from "#modules/storage/categories";
import { liveKeysCte } from "#modules/storage/live_keys";
import type Tenant from "#modules/tenancy/models/tenant";
import { dbClient } from "#services/db_context";

type TenantRef = Pick<Tenant, "id">;

const MB = 1048576;

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

	/** The studio's usage now, by category, with its allowance. */
	async usage(
		tenant: TenantRef,
		now: DateTime = DateTime.utc(),
	): Promise<StorageUsage> {
		const { rows } = (await dbClient().rawQuery(
			`${liveKeysCte}
			 select f.purpose, sum(f.bytes)::text as bytes
			 from stored_files f, t
			 where f.tenant_id = t.id
			   and ((f.status = 'stored' and f.key in (select key from live))
			     or (f.status = 'reserved' and f.expires_at > ?))
			 group by f.purpose`,
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
