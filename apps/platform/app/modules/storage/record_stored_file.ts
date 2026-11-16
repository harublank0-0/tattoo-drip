import logger from "@adonisjs/core/services/logger";
import type { TransactionClientContract } from "@adonisjs/lucid/types/database";
import type { ImagePurpose } from "#modules/media/services/image_service";
import { STORAGE_CATEGORY } from "#modules/storage/categories";
import { currentClient, withDbContext } from "#services/db_context";

/**
 * Records a stored file's size (the storage meter, Rollout step 1): one
 * `stored` row per main file, rendition or poster, replacing a reservation
 * of the same key. Purposes that never count (Fresh ink's public copies)
 * are skipped. It runs in the studio's own context: on the caller's open
 * transaction when that is the studio's, in a savepoint so a failure can't
 * abort it, else in a context of its own. Best effort: a failure is logged,
 * never thrown, so measuring can't break an upload; `storage:reconcile`
 * backfills what was missed.
 */
export async function recordStoredFile(file: {
	tenantId: string;
	key: string;
	purpose: ImagePurpose;
	bytes: number;
}): Promise<void> {
	if (STORAGE_CATEGORY[file.purpose] === null) return;
	const upsert = (client: TransactionClientContract) =>
		client.rawQuery(
			`insert into stored_files (tenant_id, key, purpose, bytes, status, stored_at, created_at, updated_at)
			 values (?, ?, ?, ?, 'stored', now(), now(), now())
			 on conflict (key) do update set bytes = excluded.bytes, purpose = excluded.purpose,
			   status = 'stored', stored_at = excluded.stored_at, expires_at = null, updated_at = now()`,
			[file.tenantId, file.key, file.purpose, file.bytes],
		);
	try {
		const parent = currentClient();
		if (parent) {
			const { rows } = await parent.rawQuery(
				"select current_setting('app.tenant_id', true) as tenant_id",
			);
			if (rows[0]?.tenant_id === file.tenantId) {
				await parent.transaction((savepoint) => upsert(savepoint));
				return;
			}
		}
		await withDbContext({ tenantId: file.tenantId }, (trx) => upsert(trx));
	} catch (error) {
		logger.error(
			{ err: error, tenantId: file.tenantId, key: file.key },
			"a stored file's size could not be recorded",
		);
	}
}
