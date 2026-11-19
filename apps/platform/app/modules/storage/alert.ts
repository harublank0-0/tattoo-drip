import logger from "@adonisjs/core/services/logger";
import type { StorageUsage } from "#modules/storage/services/storage_meter_service";
import { storageEnforcement } from "#modules/storage/settings";
import { dbClient } from "#services/db_context";

/**
 * The share of the allowance at which a studio's owners are emailed (the
 * storage meter's 95% email): the reservation queues StorageAlertJob from
 * here, and the job sends only from here.
 */
export const ALERT_AT = 0.95;

/** Under this share the alert rearms: a later crossing emails again. */
export const REARM_BELOW = 0.9;

/**
 * Rearms the 95% email once a studio's usage is under 90% (`usage`, as a
 * page just read it for the storage bar): clears its marker, in the
 * request's transaction. Pages read usage on every render while
 * STORAGE_ENFORCEMENT is on, so space freed by any delete rearms at the
 * next page a member opens, not only at the next upload. Best effort: a
 * failure is logged; the next upload under 90% rearms it too.
 */
export async function rearmWhenFreed(
	tenant: { id: string; storageAlertedAt: unknown },
	usage: StorageUsage,
): Promise<void> {
	if (tenant.storageAlertedAt === null || tenant.storageAlertedAt === undefined)
		return;
	if (storageEnforcement() !== "enforce") return;
	const { limitBytes, usedBytes } = usage;
	if (limitBytes === null || usedBytes >= limitBytes * REARM_BELOW) return;
	try {
		await dbClient()
			.from("tenants")
			.where("id", tenant.id)
			.whereNotNull("storage_alerted_at")
			.update({ storage_alerted_at: null });
	} catch (error) {
		logger.error(
			{ err: error, tenantId: tenant.id },
			"the storage alert could not be rearmed",
		);
	}
}
