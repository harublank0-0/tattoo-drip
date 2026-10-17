import logger from "@adonisjs/core/services/logger";
import Inquiry from "#modules/inquiries/models/inquiry";
import TenantJob from "#services/tenant_job";

type Payload = { tenantId: string; inquiryId: string };

/**
 * Alerts a studio's staff to a new inquiry. IntakeService.submit (TAT-51)
 * queues it in the inquiry's transaction, so it exists exactly when the
 * inquiry does. For now it only logs the two ids: TAT-52 sends the owners'
 * and the preferred artist's email and in-app alerts from here. Safe to
 * repeat; an inquiry that is gone or already decided needs no alert.
 */
export default class NewInquiryAlertJob extends TenantJob<Payload> {
	protected async handle() {
		const { tenantId, inquiryId } = this.payload;
		const inquiry = await Inquiry.query()
			.where("tenant_id", tenantId)
			.where("id", inquiryId)
			.first();
		if (!inquiry || inquiry.status !== "new") return;
		logger.info({ tenantId, inquiryId }, "New inquiry received.");
	}

	async failed(error: Error): Promise<void> {
		const { jobId } = this.context;
		const { tenantId, inquiryId } = this.payload;
		logger.error(
			{ err: error, jobId, tenantId, inquiryId },
			"Alerting staff to a new inquiry failed.",
		);
	}
}
