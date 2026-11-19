import app from "@adonisjs/core/services/app";
import logger from "@adonisjs/core/services/logger";
import { dashboardUrl } from "#modules/notifications/alerts";
import StorageNearlyFullMail from "#modules/notifications/emails/storage_nearly_full_mail";
import { ALERT_AT } from "#modules/storage/alert";
import { storageLine } from "#modules/storage/display";
import StorageMeterService from "#modules/storage/services/storage_meter_service";
import { storageEnforcement } from "#modules/storage/settings";
import TenancyService from "#modules/tenancy/services/tenancy_service";
import { withTransaction } from "#services/db_context";
import { sendMailInTransaction } from "#services/mail_in_transaction";
import TenantJob from "#services/tenant_job";
import env from "#start/env";

type Payload = { tenantId: string };

/**
 * The storage meter's 95% email (step 3): queued by an upload's reservation
 * when the studio's usage reaches 95% and its marker is unset. It checks
 * again (enforcement still on, usage still at or over 95%: a delete may have
 * freed space meanwhile), then claims the marker with
 * `update … where storage_alerted_at is null returning` and queues one
 * StorageNearlyFullMail per owner in that same transaction, so a rerun, a
 * second job or concurrent uploads email once per crossing. With
 * ALERT_EMAILS off it still claims the marker, and logs instead.
 */
export default class StorageAlertJob extends TenantJob<Payload> {
	protected async handle() {
		const { tenantId } = this.payload;
		if (storageEnforcement() !== "enforce") return;
		const tenant = { id: tenantId };
		// A studio removed since the upload has nobody to tell.
		if (!(await (await app.container.make(TenancyService)).find(tenantId))) {
			return;
		}
		const usage = await (await app.container.make(StorageMeterService)).usage(
			tenant,
		);
		const { limitBytes, usedBytes } = usage;
		if (limitBytes === null || usedBytes < limitBytes * ALERT_AT) return;

		await withTransaction(async (trx) => {
			const claimed = await trx
				.from("tenants")
				.where("id", tenantId)
				.whereNull("deleted_at")
				.whereNull("storage_alerted_at")
				.update({ storage_alerted_at: new Date() })
				.returning(["name", "slug"]);
			if (claimed.length === 0) return;
			const studio = claimed[0] as { name: string; slug: string };
			if (env.get("ALERT_EMAILS") === false) {
				logger.info(
					{ tenantId },
					"Storage alert email is off (ALERT_EMAILS=false).",
				);
				return;
			}
			const line = storageLine(usage);
			// Rounded down, so 99.6% never reads as 100%.
			const percent = Math.floor((usedBytes / limitBytes) * 100);
			const full = usedBytes >= limitBytes;
			const owners = (
				await (await app.container.make(TenancyService)).members(tenant)
			).filter((member) => member.role === "owner");
			logger.info(
				{ tenantId, percent, owners: owners.length },
				"Storage nearly full: owners emailed.",
			);
			for (const owner of owners) {
				await sendMailInTransaction(
					new StorageNearlyFullMail({
						to: owner.email,
						recipientName: owner.fullName,
						studioName: studio.name,
						percent,
						full,
						limitText: line.limitText ?? "",
						url: dashboardUrl(
							env.get("APP_URL"),
							`/t/${studio.slug}/settings/billing`,
						),
					}),
					trx,
				);
			}
		});
	}
}
