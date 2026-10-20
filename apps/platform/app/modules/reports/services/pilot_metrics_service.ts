import { inject } from "@adonisjs/core";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import InquiryService from "#modules/inquiries/services/inquiry_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import DepositService from "#modules/payments/services/deposit_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ProjectService from "#modules/projects/services/project_service";
import type { MetricsWindow, PilotFacts } from "#modules/reports/pilot_metrics";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import SessionService from "#modules/scheduling/services/session_service";

/**
 * The pilot's facts for one studio (TAT-70), from what the modules already
 * store: no table of its own. Each module answers for its own rows; every
 * read is a model query in the ambient transaction, so row-level security
 * keeps it to the studio whose context is set (the inbox request's, or the
 * one metrics:pilot sets per studio). TAT-76's reports build on it.
 */
@inject()
export default class PilotMetricsService {
	constructor(
		private inquiries: InquiryService,
		private projects: ProjectService,
		private deposits: DepositService,
		private sessions: SessionService,
	) {}

	async forStudio(
		tenant: { id: string },
		window: MetricsWindow,
	): Promise<PilotFacts> {
		const linkInquiries = await this.inquiries.countReceived(tenant, window);
		const deskProjects = await this.projects.countBookedAtDesk(tenant, window);

		const deposits = await this.deposits.firstVerifiedDeposits(tenant, window);
		const inquiryOf = await this.projects.inquiryIdsFor(
			tenant,
			deposits.map(({ projectId }) => projectId),
		);
		const receivedAt = await this.inquiries.receivedAt(tenant, [
			...inquiryOf.values(),
		]);
		const depositHours = deposits.flatMap(({ projectId, verifiedAt }) => {
			const inquiryId = inquiryOf.get(projectId);
			const received = inquiryId ? receivedAt.get(inquiryId) : undefined;
			if (!received) return [];
			return [Math.max(0, verifiedAt.diff(received, "hours").hours)];
		});

		const { studio } = await this.sessions.countByStatus(tenant, window);
		return {
			linkInquiries,
			deskProjects,
			depositHours,
			sessions: {
				completed: studio.completed,
				noShow: studio.no_show,
				// The window ends now, so a session still scheduled in it has started.
				noOutcome: studio.scheduled,
			},
		};
	}
}
