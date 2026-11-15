import { inject } from "@adonisjs/core";
import type { TransactionClientContract } from "@adonisjs/lucid/types/database";
import { DateTime } from "luxon";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ArtistService from "#modules/artists/services/artist_service";
import type Inquiry from "#modules/inquiries/models/inquiry";
import {
	ALERT_KINDS,
	type AlertKind,
	dashboardUrl,
	excerpt,
	freshInkIntro,
	inquiryIntro,
	inquiryRecipients,
	onlinePaymentIntro,
	paymentsCardPath,
	proofIntro,
	reviewsPath,
	transactionsPath,
} from "#modules/notifications/alerts";
import DepositProofMail from "#modules/notifications/emails/deposit_proof_mail";
import FreshInkMail from "#modules/notifications/emails/fresh_ink_mail";
import NewInquiryMail from "#modules/notifications/emails/new_inquiry_mail";
import OnlinePaymentMail from "#modules/notifications/emails/online_payment_mail";
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
 * What a Fresh ink alert needs (FreshInkAlertJob gathers it): the post, its
 * round in the studio's queue, the project's artist profile and the name the
 * client chose to show (never their full name, phone or email).
 */
export type FreshInk = {
	postId: string;
	round: number;
	artistId: string | null;
	shownName: string;
};

/**
 * What an online-payment alert needs (OnlinePaymentAlertJob gathers it): the
 * gateway payment, whether it was held for review, its project, the
 * project's artist profile and the client's name as the studio stores it.
 */
export type OnlinePayment = {
	gatewayPaymentId: string;
	held: boolean;
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

	/**
	 * Alerts the studio's owners, and the member linked to the project's live
	 * artist profile, that a Fresh ink post waits for approval
	 * (FreshInkAlertJob, Reviews and Fresh ink slice 2): the deposit proof's
	 * rule. Each member gets one alert and one email per post per round
	 * (unique (user_id, post_id, post_round) and `on conflict do nothing`), so
	 * a client's change of an approved post alerts again and a rerun adds
	 * nothing. The email names the client only by the name they chose to show
	 * and links to the Reviews page. Returns the users alerted by this call.
	 */
	async freshInk(
		tenant: TenantRef,
		post: FreshInk,
		options: AlertOptions = {},
	): Promise<string[]> {
		const studio = await this.tenancy.find(tenant.id);
		if (!studio) return [];
		const members = await this.tenancy.members(tenant);
		const artist = post.artistId
			? (await this.artists.list(tenant)).find(({ id }) => id === post.artistId)
			: undefined;
		const recipients = inquiryRecipients(members, artist?.userId ?? null);
		const emails = options.emails ?? env.get("ALERT_EMAILS") !== false;
		const url = dashboardUrl(env.get("APP_URL"), reviewsPath(studio.slug));

		return withTransaction(async (trx) => {
			const inserted = await insertAlerts(
				trx,
				tenant,
				{ kind: "fresh_ink", postId: post.postId, round: post.round },
				recipients.map(({ userId }) => userId),
			);
			const alerted = recipients.filter(({ userId }) => inserted.has(userId));
			if (emails) {
				for (const recipient of alerted) {
					await sendMailInTransaction(
						new FreshInkMail({
							to: recipient.email,
							recipientName: recipient.fullName,
							studioName: studio.name,
							intro: freshInkIntro({
								shownName: post.shownName,
								studioName: studio.name,
								edited: post.round > 1,
								yourProject: recipient.askedForYou,
							}),
							edited: post.round > 1,
							url,
						}),
						trx,
					);
				}
			}
			return alerted.map(({ userId }) => userId);
		});
	}

	/**
	 * Alerts the studio to a client's online payment through PayBridgeNP
	 * (OnlinePaymentAlertJob). A recorded deposit reaches the owners and the
	 * member linked to the project's live artist profile, as a deposit
	 * screenshot does, and points at the project's Payments card. A payment
	 * held for review reaches the owners only, who alone can open
	 * Transactions, where it points. Each member gets one alert and one email
	 * per gateway payment, once: the unique (user_id, gateway_payment_id) and
	 * `on conflict do nothing` make a repeated run add nothing, and each
	 * email is queued in the same transaction as its alert. Returns the
	 * users alerted by this call.
	 */
	async onlinePayment(
		tenant: TenantRef,
		paid: OnlinePayment,
		options: AlertOptions = {},
	): Promise<string[]> {
		const studio = await this.tenancy.find(tenant.id);
		if (!studio) return [];
		const members = await this.tenancy.members(tenant);
		const artist =
			paid.artistId && !paid.held
				? (await this.artists.list(tenant)).find(
						({ id }) => id === paid.artistId,
					)
				: undefined;
		// askedForYou marks the project's artist here: "for your project".
		const recipients = inquiryRecipients(members, artist?.userId ?? null);
		const emails = options.emails ?? env.get("ALERT_EMAILS") !== false;
		const url = dashboardUrl(
			env.get("APP_URL"),
			paid.held
				? transactionsPath(studio.slug)
				: paymentsCardPath(studio.slug, paid.projectId),
		);

		return withTransaction(async (trx) => {
			const inserted = await insertAlerts(
				trx,
				tenant,
				{
					kind: paid.held ? "online_review" : "online_deposit",
					projectId: paid.projectId,
					gatewayPaymentId: paid.gatewayPaymentId,
				},
				recipients.map(({ userId }) => userId),
			);
			const alerted = recipients.filter(({ userId }) => inserted.has(userId));
			if (emails) {
				for (const recipient of alerted) {
					await sendMailInTransaction(
						new OnlinePaymentMail({
							to: recipient.email,
							recipientName: recipient.fullName,
							studioName: studio.name,
							intro: onlinePaymentIntro({
								clientName: paid.clientName,
								studioName: studio.name,
								held: paid.held,
								yourProject: recipient.askedForYou,
							}),
							held: paid.held,
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

	/**
	 * How many of the member's alerts here are unread, of `kinds` (every kind
	 * by default): the Alerts page counts them all, the shell's bell only
	 * what no tab counts (`bellKinds`, TAT-107). No kinds, no query.
	 */
	async unreadCount(
		tenant: TenantRef,
		userId: string,
		kinds: readonly AlertKind[] = ALERT_KINDS,
	): Promise<number> {
		if (kinds.length === 0) return 0;
		const [row] = await StaffAlert.query()
			.where("tenant_id", tenant.id)
			.where("user_id", userId)
			.whereIn("kind", [...kinds])
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

/**
 * What one alert row names: an inquiry, a payment and its project (TAT-88),
 * a post and its round (slice 2), or a gateway payment and its project.
 */
type AlertSubject =
	| { kind: "new_inquiry"; inquiryId: string }
	| { kind: "deposit_proof"; projectId: string; paymentId: string }
	| { kind: "fresh_ink"; postId: string; round: number }
	| {
			kind: "online_deposit" | "online_review";
			projectId: string;
			gatewayPaymentId: string;
	  };

/** Inserts one alert per user about `subject`, skipping those that exist; returns the users inserted now. */
async function insertAlerts(
	trx: TransactionClientContract,
	tenant: TenantRef,
	subject: AlertSubject,
	userIds: string[],
): Promise<Set<string>> {
	if (userIds.length === 0) return new Set();
	// Only the columns the kind names: constants, never request data.
	const { columns, ids } = subjectColumns(subject);
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

/** The columns and values an alert about `subject` sets: constants, never request data. */
function subjectColumns(subject: AlertSubject): {
	columns: string[];
	ids: (string | number)[];
} {
	switch (subject.kind) {
		case "new_inquiry":
			return { columns: ["inquiry_id"], ids: [subject.inquiryId] };
		case "deposit_proof":
			return {
				columns: ["project_id", "payment_id"],
				ids: [subject.projectId, subject.paymentId],
			};
		case "fresh_ink":
			return {
				columns: ["post_id", "post_round"],
				ids: [subject.postId, subject.round],
			};
		default:
			return {
				columns: ["project_id", "gateway_payment_id"],
				ids: [subject.projectId, subject.gatewayPaymentId],
			};
	}
}
