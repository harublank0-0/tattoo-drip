import { randomUUID } from "node:crypto";
import { mock } from "node:test";
import logger from "@adonisjs/core/services/logger";
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import NewInquiryAlertJob from "#modules/inquiries/jobs/new_inquiry_alert_job";
import { makeClient, makeInquiry } from "#tests/helpers/pipeline";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

const MESSAGE = "New inquiry received.";

/** Runs the job the way the worker does and returns what it logged at info level. */
async function run(payload: { tenantId: string; inquiryId: string }) {
	const job = new NewInquiryAlertJob();
	job.$hydrate(payload, {
		jobId: "new-inquiry-alert-spec",
		name: "NewInquiryAlertJob",
		attempt: 1,
		queue: "default",
		priority: 0,
		acquiredAt: new Date(),
		stalledCount: 0,
	});
	const info = mock.method(logger, "info", () => {});
	try {
		await job.execute();
	} finally {
		info.mock.restore();
	}
	return info.mock.calls
		.map((call) => call.arguments)
		.filter((args) => args[1] === MESSAGE);
}

test.group("NewInquiryAlertJob", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("logs a new inquiry's ids, and no contact details", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("alert-needle-51");
		const inquiry = await inTenant(tenant, async () =>
			makeInquiry(tenant, await makeClient(tenant)),
		);

		const logged = await run({ tenantId: tenant.id, inquiryId: inquiry.id });

		assert.deepEqual(logged, [
			[{ tenantId: tenant.id, inquiryId: inquiry.id }, MESSAGE],
		]);
	});

	test("a decided, missing or other studio's inquiry needs no alert", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("alert-a-51");
		const other = await studioWithOwner("alert-b-51");
		const declined = await inTenant(tenant, async () =>
			makeInquiry(tenant, await makeClient(tenant), {
				status: "declined",
				decidedAt: DateTime.now(),
			}),
		);
		const theirs = await inTenant(other.tenant, async () =>
			makeInquiry(other.tenant, await makeClient(other.tenant)),
		);

		for (const inquiryId of [declined.id, randomUUID(), theirs.id]) {
			assert.deepEqual(
				await run({ tenantId: tenant.id, inquiryId }),
				[],
				inquiryId,
			);
		}
	});
});
