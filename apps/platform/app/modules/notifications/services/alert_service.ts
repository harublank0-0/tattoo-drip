import { inject } from "@adonisjs/core";
import type { TransactionClientContract } from "@adonisjs/lucid/types/database";
import { DateTime } from "luxon";
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
import StaffAlert from "#modules/notifications/models/staff_alert";
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

export type AlertPage = {
	alerts: StaffAlert[];
	total: number;
	lastPage: number;
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

	/** The member's alerts in this studio, newest first, 25 a page. */
	async list(
		tenant: TenantRef,
		userId: string,
		page: number,
	): Promise<AlertPage> {
		const result = await StaffAlert.query()
			.where("tenant_id", tenant.id)
			.where("user_id", userId)
			.orderBy("created_at", "desc")
			.orderBy("id", "desc")
			.paginate(page, ALERTS_PER_PAGE);
		return {
			alerts: result.all(),
			total: result.total,
			lastPage: result.lastPage,
		};
	}

	/** How many of the member's alerts here are unread: the shell's count. */
	async unreadCount(tenant: TenantRef, userId: string): Promise<number> {
		const [row] = await StaffAlert.query()
			.where("tenant_id", tenant.id)
			.where("user_id", userId)
			.whereNull("read_at")
			.count("* as total");
		return Number(row.$extras.total);
	}

	/**
	 * The member's own alert, marked read (once: its first read time stays).
	 * Another member's, another studio's or an unknown id is E_ROW_NOT_FOUND
	 * (a 404).
	 */
	async open(
		tenant: TenantRef,
		userId: string,
		id: string,
	): Promise<StaffAlert> {
		const alert = await StaffAlert.query()
			.where("tenant_id", tenant.id)
			.where("user_id", userId)
			.where("id", id)
			.firstOrFail();
		if (alert.readAt === null) {
			alert.readAt = DateTime.now();
			await alert.save();
		}
		return alert;
	}

	/** Marks every unread alert of the member in this studio read. */
	async markAllRead(tenant: TenantRef, userId: string): Promise<void> {
		await StaffAlert.query()
			.where("tenant_id", tenant.id)
			.where("user_id", userId)
			.whereNull("read_at")
			.update({ read_at: DateTime.now().toJSDate() });
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
