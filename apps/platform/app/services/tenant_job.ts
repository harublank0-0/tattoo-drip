import { Job } from "@adonisjs/queue";
import { withDbContext } from "#services/db_context";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Base class for jobs that touch tenant-owned data. The payload carries
 * `tenantId` (the TAT-7 convention); `execute()` runs the subclass's
 * `handle()` in that tenant's context and in one transaction, so a throw
 * rolls every write back before the worker retries or fails the job, and
 * the worker acknowledges the job only after the commit.
 *
 * Why a base class and not `executionWrapper` in config/queue.ts: the
 * worker catches a job's error inside the callback a wrapper receives, so
 * a wrapper cannot see a failure, and the worker acknowledges the job
 * before a wrapper could commit.
 *
 * Lives here, not in app/jobs: the worker registers the default export of
 * every file in the jobs folders as a job.
 */
export default abstract class TenantJob<
	Payload extends { tenantId: string },
> extends Job<Payload> {
	async execute(): Promise<void> {
		const tenantId: unknown = this.payload?.tenantId;
		if (typeof tenantId !== "string" || !UUID.test(tenantId)) {
			throw new Error("A TenantJob payload needs a valid tenantId");
		}
		await withDbContext({ tenantId }, () => this.handle());
	}

	protected abstract handle(): Promise<void>;
}
