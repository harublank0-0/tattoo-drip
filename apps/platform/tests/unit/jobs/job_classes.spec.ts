import { glob } from "node:fs/promises";
import app from "@adonisjs/core/services/app";
import { Job } from "@adonisjs/queue";
import { test } from "@japa/runner";
import { jobsOutsideTenantScope } from "#tests/helpers/jobs";

/**
 * Jobs allowed to run with no tenant, and why. Anything else that touches
 * tenant data must extend TenantJob (app/services/tenant_job.ts).
 */
const ALLOWLIST = {
	SendMailJob: "sends one email; reads and writes no tenant table",
	ProcessWorkVideoJob:
		"video angles: a transcode takes minutes and a TenantJob holds one transaction for all of it (production ends one idle for 3); it opens none itself and reads and writes its row only in short withDbContext transactions scoped to the payload's tenantId (WorkPhotoService.processVideo)",
	ProcessClientPostVideoJob:
		"Reviews and Fresh ink: a client's video on the work videos' pipeline, for the same reason; it reads and writes its item only in short withDbContext transactions scoped to the payload's tenantId (ClientPostService.processVideo)",
	SweepStuckVideosJob:
		"reads only ids from stuck_video_candidates() and stuck_client_video_candidates() and queues one FailStuckVideoJob or FailStuckClientVideoJob (TenantJobs) per row; reads and writes no tenant table itself",
	SweepStaleSubmittersJob:
		"Reviews and Fresh ink: reads only tenant ids from stale_submitter_tenants() and queues one ClearSubmittersJob (a TenantJob) per tenant; reads and writes no tenant table itself",
	SweepExpiredQuotesJob:
		"reads only ids from expired_quote_candidates() and queues one ExpireQuoteJob (a TenantJob) per row; reads and writes no tenant table itself",
};

async function jobClasses() {
	const classes: { name: string; prototype: object }[] = [];
	for (const pattern of ["app/jobs/**/*.ts", "app/modules/*/jobs/**/*.ts"]) {
		for await (const file of glob(pattern, { cwd: app.makePath() })) {
			const module = await import(app.makeURL(file).href);
			if (typeof module.default === "function") classes.push(module.default);
		}
	}
	return classes;
}

test.group("Job classes", () => {
	test("every job extends TenantJob or is allowlisted", async ({ assert }) => {
		const classes = await jobClasses();
		assert.isNotEmpty(classes);
		assert.deepEqual(jobsOutsideTenantScope(classes, ALLOWLIST), []);
	});

	test("the guard flags a plain job that is not allowlisted", ({ assert }) => {
		class StrayJob extends Job<{ label: string }> {
			async execute() {}
		}
		assert.deepEqual(jobsOutsideTenantScope([StrayJob], ALLOWLIST), [
			"StrayJob",
		]);
	});
});
