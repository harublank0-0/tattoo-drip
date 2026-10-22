import { inject } from "@adonisjs/core";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ArtistService from "#modules/artists/services/artist_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ClientService from "#modules/clients/services/client_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import InquiryService from "#modules/inquiries/services/inquiry_service";
import type { AlertContent } from "#modules/notifications/alerts";
import type StaffAlert from "#modules/notifications/models/staff_alert";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import DepositService from "#modules/payments/services/deposit_service";
import { formatMoney } from "#modules/projects/quotes";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ProjectService, {
	type Member,
} from "#modules/projects/services/project_service";
import type Tenant from "#modules/tenancy/models/tenant";

type TenantRef = Pick<Tenant, "id">;

/** The columns of a StaffAlert this service reads. */
type AlertSubjects = Pick<
	StaffAlert,
	"id" | "kind" | "inquiryId" | "projectId" | "paymentId"
>;

/**
 * What the alerts on a page of the Alerts list are about (TAT-102): the
 * client and the idea of a new inquiry, the client and the amount of a
 * deposit screenshot. An alert row holds ids only (spec ruling 5), so this
 * reads the rest at render time, in a fixed number of queries however many
 * alerts the page holds, each scoped to the tenant by the services that own
 * the tables.
 *
 * Who may see what follows what the member can open now, never more, and
 * never what an old alert row once allowed (alerts outlive a demotion or a
 * removal):
 * - a new-inquiry alert shows the inquiry's contact name and idea to a
 *   current owner, and to an artist only when the client asked for that
 *   artist (the inquiry's `preferredArtistId` is the member's own live
 *   profile), the words that artist's email already carried. Anyone else,
 *   an owner demoted to artist or removed and invited again included, keeps
 *   the fixed line, because the inbox is owners only;
 * - a deposit-proof alert shows the project's client only while the member
 *   may open the project (`ProjectService.findManyFor`: owners any, an
 *   artist their own), and the amount to owners only.
 * An alert whose subject is gone or out of reach has no entry: the list
 * keeps the fixed line (`alertCopy`).
 */
@inject()
export default class AlertContentService {
	constructor(
		private artists: ArtistService,
		private inquiries: InquiryService,
		private projects: ProjectService,
		private clients: ClientService,
		private deposits: DepositService,
	) {}

	/** The content of each alert that has some, by alert id. */
	async forAlerts(
		tenant: TenantRef,
		member: Member,
		alerts: AlertSubjects[],
	): Promise<Map<string, AlertContent>> {
		const content = new Map<string, AlertContent>();
		await this.forInquiries(tenant, member, alerts, content);
		await this.forProofs(tenant, member, alerts, content);
		return content;
	}

	private async forInquiries(
		tenant: TenantRef,
		member: Member,
		alerts: AlertSubjects[],
		into: Map<string, AlertContent>,
	): Promise<void> {
		const mine = alerts.filter(
			({ kind, inquiryId }) => kind === "new_inquiry" && inquiryId !== null,
		);
		if (mine.length === 0) return;
		// An owner reads every inquiry; an artist only those that asked for
		// their own live profile (none without one).
		const isOwner = member.role === "owner";
		const ownProfileId = isOwner
			? null
			: ((await this.artists.profileOf(tenant, member.userId))?.id ?? null);
		if (!isOwner && ownProfileId === null) return;
		const found = new Map(
			(
				await this.inquiries.findMany(
					tenant,
					mine.map(({ inquiryId }) => inquiryId as string),
				)
			).map((inquiry) => [inquiry.id, inquiry]),
		);
		for (const alert of mine) {
			const inquiry = found.get(alert.inquiryId as string);
			if (!inquiry) continue;
			if (!isOwner && inquiry.preferredArtistId !== ownProfileId) continue;
			into.set(alert.id, {
				kind: "new_inquiry",
				clientName: inquiry.contactName,
				idea: inquiry.idea,
			});
		}
	}

	private async forProofs(
		tenant: TenantRef,
		member: Member,
		alerts: AlertSubjects[],
		into: Map<string, AlertContent>,
	): Promise<void> {
		const mine = alerts.filter(
			({ kind, projectId }) => kind === "deposit_proof" && projectId !== null,
		);
		const projects = new Map(
			(
				await this.projects.findManyFor(
					tenant,
					member,
					mine.map(({ projectId }) => projectId as string),
				)
			).map((project) => [project.id, project]),
		);
		const names = new Map(
			(
				await this.clients.findMany(
					tenant,
					[...projects.values()].map(({ clientId }) => clientId),
				)
			).map((client) => [client.id, client.name]),
		);
		const amounts =
			member.role === "owner"
				? await this.deposits.amountsFor(
						tenant,
						mine.flatMap(({ paymentId }) => (paymentId ? [paymentId] : [])),
					)
				: new Map<string, number>();
		for (const alert of mine) {
			const project = projects.get(alert.projectId as string);
			if (!project) continue;
			const amount = alert.paymentId ? amounts.get(alert.paymentId) : undefined;
			into.set(alert.id, {
				kind: "deposit_proof",
				clientName: names.get(project.clientId) ?? "",
				amountText: amount === undefined ? null : formatMoney(amount),
			});
		}
	}
}
