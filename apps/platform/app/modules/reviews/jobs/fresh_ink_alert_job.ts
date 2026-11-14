import app from "@adonisjs/core/services/app";
import logger from "@adonisjs/core/services/logger";
import AlertService from "#modules/notifications/services/alert_service";
import ProjectService from "#modules/projects/services/project_service";
import ClientPost from "#modules/reviews/models/client_post";
import TenantJob from "#services/tenant_job";

type Payload = { tenantId: string; postId: string; round: number };

/**
 * Alerts a studio's staff that a Fresh ink post waits for their approval
 * (Reviews and Fresh ink, slice 2): queued by ClientPostService in the
 * transaction that put the post in the queue (the client's submit, or a
 * client's change of an approved post), with the post's round. It logs the
 * ids, then AlertService.freshInk alerts the owners and the member linked to
 * the project's artist in the dashboard and by email, once per member per
 * post per round however often the job runs. A post that is gone, decided,
 * taken down or in a later round needs no alert (that round has its own job).
 */
export default class FreshInkAlertJob extends TenantJob<Payload> {
	protected async handle() {
		const { tenantId, postId, round } = this.payload;
		const post = await ClientPost.query()
			.where("tenant_id", tenantId)
			.where("id", postId)
			.first();
		if (
			!post ||
			post.status !== "waiting" ||
			post.submittedAt === null ||
			post.takenDownAt !== null ||
			post.waitingRound !== round
		) {
			return;
		}
		logger.info(
			{ tenantId, projectId: post.projectId, postId, round },
			"Fresh ink waiting for approval.",
		);

		const tenant = { id: tenantId };
		const projects = await app.container.make(ProjectService);
		const project = await projects.findLive(tenant, post.projectId);
		if (!project) return;
		const alerts = await app.container.make(AlertService);
		await alerts.freshInk(tenant, {
			postId: post.id,
			round,
			artistId: project.artistId,
			shownName: post.shownName,
		});
	}

	async failed(error: Error): Promise<void> {
		const { jobId } = this.context;
		const { tenantId, postId, round } = this.payload;
		logger.error(
			{ err: error, jobId, tenantId, postId, round },
			"Alerting staff to Fresh ink failed.",
		);
	}
}
