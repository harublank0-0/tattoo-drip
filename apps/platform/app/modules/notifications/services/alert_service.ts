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
	paymentsCardPath,
	proofIntro,
} from "#modules/notifications/alerts";
import DepositProofMail from "#modules/notifications/emails/deposit_proof_mail";
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
 * What a deposit-proof alert needs (DepositProofAlertJob gathers it): the
 * payment, its project, the project's artist profile and the client's name
 * as the studio stores it.
 */
export type DepositProof = {
	paymentId: string;
	projectId: string;
	artistId: string | null;
	clientName: string;
};

/**
 * Staff alerts (TAT-52, TAT-88): made by the jobs that learn of an event, read by
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
				{ kind: "new_inquiry", inquiryId: inquiry.id },
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

	/**
	 * Alerts the studio's owners, and the member linked to the project's
	 * live artist profile, that a client sent a deposit screenshot
	 * (DepositProofAlertJob, TAT-88): the new-inquiry rule with the project's
	 * artist in place of the asked-for one. Each member gets one alert and
	 * one email per payment, once: the unique (user_id, payment_id) and `on
	 * conflict do nothing` make a repeated run add nothing, and each email is
	 * queued in the same transaction as its alert. Both point at the
	 * project's Payments card. Returns the users alerted by this call.
	 */
	async depositProof(
		tenant: TenantRef,
		proof: DepositProof,
		options: AlertOptions = {},
	): Promise<string[]> {
		const studio = await this.tenancy.find(tenant.id);
		if (!studio) return [];
		const members = await this.tenancy.members(tenant);
		const artist = proof.artistId
			? (await this.artists.list(tenant)).find(
					({ id }) => id === proof.artistId,
				)
			: undefined;
		// askedForYou marks the project's artist here: "for your project".
		const recipients = inquiryRecipients(members, artist?.userId ?? null);
		const emails = options.emails ?? env.get("ALERT_EMAILS") !== false;
		const url = dashboardUrl(
			env.get("APP_URL"),
			paymentsCardPath(studio.slug, proof.projectId),
		);

		return withTransaction(async (trx) => {
			const inserted = await insertAlerts(
				trx,
				tenant,
				{
					kind: "deposit_proof",
					projectId: proof.projectId,
					paymentId: proof.paymentId,
				},
				recipients.map(({ userId }) => userId),
			);
			const alerted = recipients.filter(({ userId }) => inserted.has(userId));
			if (emails) {
				for (const recipient of alerted) {
					await sendMailInTransaction(
						new DepositProofMail({
							to: recipient.email,
							recipientName: recipient.fullName,
							studioName: studio.name,
							intro: proofIntro({
								clientName: proof.clientName,
								studioName: studio.name,
								yourProject: recipient.askedForYou,
							}),
							forOwner: recipient.role === "owner",
							url,
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

/** What one alert row names: an inquiry, or a payment and its project (TAT-88). */
type AlertSubject =
	| { kind: "new_inquiry"; inquiryId: string }
	| { kind: "deposit_proof"; projectId: string; paymentId: string };

/** Inserts one alert per user about `subject`, skipping those that exist; returns the users inserted now. */
async function insertAlerts(
	trx: TransactionClientContract,
	tenant: TenantRef,
	subject: AlertSubject,
	userIds: string[],
): Promise<Set<string>> {
	if (userIds.length === 0) return new Set();
	// Only the columns the kind names: constants, never request data.
	const { columns, ids } =
		subject.kind === "new_inquiry"
			? { columns: ["inquiry_id"], ids: [subject.inquiryId] }
			: {
					columns: ["project_id", "payment_id"],
					ids: [subject.projectId, subject.paymentId],
				};
	const row = `(?, ?, ?, ${ids.map(() => "?").join(", ")}, now())`;
	const { rows } = await trx.rawQuery(
		`insert into staff_alerts (tenant_id, user_id, kind, ${columns.join(", ")}, created_at)
		 values ${userIds.map(() => row).join(", ")}
		 on conflict do nothing
		 returning user_id`,
		userIds.flatMap((userId) => [tenant.id, userId, subject.kind, ...ids]),
	);
	return new Set((rows as { user_id: string }[]).map((row) => row.user_id));
}
