import { args, BaseCommand } from "@adonisjs/core/ace";
import type { CommandOptions } from "@adonisjs/core/types/ace";

/**
 * Makes the storage ledger match storage
 * (docs/superpowers/specs/2026-11-16-storage-meter-design.md, Backfill and
 * reconcile), for one studio or every live studio, each in its own context:
 * every file a live record holds gets a size row (the size read from
 * storage), rows no live record holds and expired reservations are removed,
 * and a live key whose file is missing is reported, not counted. Safe to run
 * again. Run it once after deploying the meter, and before switching
 * STORAGE_ENFORCEMENT on.
 *
 *   node ace storage:reconcile            (every live studio)
 *   node ace storage:reconcile black-needle
 *   node build/ace.js storage:reconcile   (production)
 */
export default class StorageReconcile extends BaseCommand {
	static commandName = "storage:reconcile";
	static description =
		"Make the storage ledger match each studio's stored files (safe to run again)";
	static options: CommandOptions = { startApp: true };

	@args.string({
		description:
			"One studio's current or old slug; every live studio when left out",
		required: false,
	})
	declare slug?: string;

	async run() {
		const drive = (await import("@adonisjs/drive/services/main")).default;
		const { DateTime } = await import("luxon");
		const { IMAGE_PURPOSES } = await import(
			"#modules/media/services/image_service"
		);
		const { STORAGE_CATEGORY, formatBytes } = await import(
			"#modules/storage/categories"
		);
		const { liveKeysCte } = await import("#modules/storage/live_keys");
		const { default: StoredFile } = await import(
			"#modules/storage/models/stored_file"
		);
		const { default: StorageMeterService } = await import(
			"#modules/storage/services/storage_meter_service"
		);
		const { default: Tenant } = await import("#modules/tenancy/models/tenant");
		const { dbClient, withDbContext } = await import("#services/db_context");
		const { liveStudioIds } = await import("#services/live_studios");
		type Purpose = keyof typeof IMAGE_PURPOSES;

		let tenantIds: string[];
		if (this.slug) {
			const { rows } = await dbClient().rawQuery(
				"select public.tenant_for_slug(?) as id",
				[this.slug],
			);
			const id: string | null = rows[0]?.id ?? null;
			if (!id) {
				this.logger.error(`No studio uses "${this.slug}".`);
				this.exitCode = 1;
				return;
			}
			tenantIds = [id];
		} else {
			tenantIds = await liveStudioIds();
		}

		const meter = await this.app.container.make(StorageMeterService);
		for (const tenantId of tenantIds) {
			await withDbContext({ tenantId }, async (trx) => {
				const tenant = await Tenant.find(tenantId, { client: trx });
				if (!tenant) return;
				const now = DateTime.utc();
				const { rows } = await trx.rawQuery(
					`${liveKeysCte} select distinct key from live`,
					[tenantId],
				);
				const live = new Set<string>(
					rows.map((row: { key: string }) => row.key),
				);
				const stored = new Set(
					(
						await StoredFile.query({ client: trx })
							.where("tenant_id", tenantId)
							.where("status", "stored")
							.select("key")
					).map((row) => row.key),
				);

				let recorded = 0;
				let missing = 0;
				for (const key of live) {
					if (stored.has(key)) continue;
					const purpose = /^tenants\/[^/]+\/([a-z_]+)\//.exec(key)?.[1] as
						| Purpose
						| undefined;
					if (!purpose || !(purpose in IMAGE_PURPOSES)) continue;
					if (STORAGE_CATEGORY[purpose] === null) continue;
					let bytes: number;
					try {
						const meta = await drive
							.use(IMAGE_PURPOSES[purpose].visibility)
							.getMetaData(key);
						bytes = Number(meta.contentLength ?? 0);
					} catch {
						missing += 1;
						this.logger.warning(`${tenant.slug}: missing file ${key}`);
						continue;
					}
					await trx.rawQuery(
						`insert into stored_files (tenant_id, key, purpose, bytes, status, stored_at, created_at, updated_at)
						 values (?, ?, ?, ?, 'stored', now(), now(), now())
						 on conflict (key) do update set bytes = excluded.bytes, purpose = excluded.purpose,
						   status = 'stored', stored_at = excluded.stored_at, expires_at = null, updated_at = now()`,
						[tenantId, key, purpose, bytes],
					);
					recorded += 1;
				}

				const stale = await StoredFile.query({ client: trx })
					.where("tenant_id", tenantId)
					.where((query) =>
						query
							.where((stored) =>
								stored.where("status", "stored").whereNotIn("key", [...live]),
							)
							.orWhere((reserved) =>
								reserved
									.where("status", "reserved")
									.where("expires_at", "<=", now.toJSDate()),
							),
					)
					.delete();
				const removed = Number(stale[0] ?? 0);

				const usage = await meter.usage(tenant, now);
				this.logger.info(
					`${tenant.slug}: ${recorded} recorded, ${removed} removed, ${missing} missing files, usage ${formatBytes(usage.usedBytes)} of ${usage.limitBytes === null ? "unmetered" : formatBytes(usage.limitBytes)}`,
				);
			});
		}
	}
}
