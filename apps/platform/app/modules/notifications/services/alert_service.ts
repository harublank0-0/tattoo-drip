import { inject } from "@adonisjs/core";
import type { TransactionClientContract } from "@adonisjs/lucid/types/database";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ArtistService from "#modules/artists/services/artist_service";
import type Inquiry from "#modules/inquiries/models/inquiry";
import {
	dashboardUrl,
	excerpt,
	inquiryIntro,
	inquiryRecipients,
} from "#modules/notifications/alerts";
import NewInquiryMail from "#modules/notifications/emails/new_inquiry_mail";
import type Tenant from "#modules/tenancy/models/tenant";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import TenancyService from "#modules/tenancy/services/tenancy_service";
import { withTransaction } from "#services/db_context";
import { sendMailInTransaction } from "#services/mail_in_transaction";
import env from "#start/env";

type TenantRef = Pick<Tenant, "id">;

/** Alerts per page on the Alerts page. */
export const ALERTS_PER_PAGE = 25;

export type AlertOptions = {
	/** Queue the emails; ALERT_EMAILS by default (unset is on). */
	emails?: boolean;
};

/**
 * Staff alerts (TAT-52): made by the jobs that learn of an event, read by
 * each member on the Alerts page. A row holds ids only (spec ruling 5).
 */
@inject()
export default class AlertService {
	constructor(
		private tenancy: TenancyService,
		private artists: ArtistService,
	) {}

	/**
	 * Alerts the studio's owners, and the member linked to the inquiry's live
	 * preferred artist, to a new inquiry (NewInquiryAlertJob). Each member
	 * gets one alert and one email, once: the unique (user_id, inquiry_id)
	 * and `on conflict do nothing` make a repeated run add nothing, and each
	 * email is queued in the same transaction as its alert. Returns the users
	 * alerted by this call.
	 */
	async newInquiry(
		tenant: TenantRef,
		inquiry: Pick<Inquiry, "id" | "contactName" | "idea" | "preferredArtistId">,
		options: AlertOptions = {},
	): Promise<string[]> {
		const studio = await this.tenancy.find(tenant.id);
		if (!studio) return [];
		const members = await this.tenancy.members(tenant);
		const artist = inquiry.preferredArtistId
			? (await this.artists.list(tenant)).find(
					({ id }) => id === inquiry.preferredArtistId,
				)
			: undefined;
		const recipients = inquiryRecipients(members, artist?.userId ?? null);
		const emails = options.emails ?? env.get("ALERT_EMAILS") !== false;

		return withTransaction(async (trx) => {
			const inserted = await insertAlerts(
				trx,
				tenant,
				inquiry.id,
				recipients.map(({ userId }) => userId),
			);
			const alerted = recipients.filter(({ userId }) => inserted.has(userId));
			if (emails) {
				for (const recipient of alerted) {
					await sendMailInTransaction(
						new NewInquiryMail({
							to: recipient.email,
							recipientName: recipient.fullName,
							studioName: studio.name,
							intro: inquiryIntro({
								clientName: inquiry.contactName,
								studioName: studio.name,
								artistName: artist?.name ?? null,
								askedForYou: recipient.askedForYou,
							}),
							excerpt: excerpt(inquiry.idea),
							url:
								recipient.role === "owner"
									? dashboardUrl(
											env.get("APP_URL"),
											`/t/${studio.slug}/inbox/${inquiry.id}`,
										)
									: null,
						}),
						trx,
					);
				}
			}
			return alerted.map(({ userId }) => userId);
		});
	}
}

/** Inserts one new-inquiry alert per user, skipping those that exist; returns the users inserted now. */
async function insertAlerts(
	trx: TransactionClientContract,
	tenant: TenantRef,
	inquiryId: string,
	userIds: string[],
): Promise<Set<string>> {
	if (userIds.length === 0) return new Set();
	const { rows } = await trx.rawQuery(
		`insert into staff_alerts (tenant_id, user_id, kind, inquiry_id, created_at)
		 values ${userIds.map(() => "(?, ?, 'new_inquiry', ?, now())").join(", ")}
		 on conflict do nothing
		 returning user_id`,
		userIds.flatMap((userId) => [tenant.id, userId, inquiryId]),
	);
	return new Set((rows as { user_id: string }[]).map((row) => row.user_id));
}
