import testUtils from "@adonisjs/core/services/test_utils";
import queue from "@adonisjs/queue/services/main";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import PackageNoticeJob from "#modules/packages/jobs/package_notice_job";
import SweepPackageNoticesJob from "#modules/packages/jobs/sweep_package_notices_job";
import { sweepMoment } from "#modules/packages/notices";
import type Tenant from "#modules/tenancy/models/tenant";
import { dbClient } from "#services/db_context";
import { captureLogs } from "#tests/helpers/logs";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

/**
 * Package notices (studio packages, phase 3): a daily sweep queues one
 * PackageNoticeJob per live studio, which logs the notice due (observe mode:
 * nothing is sent yet).
 */

const context = (name: string) => ({
	jobId: `${name}-spec`,
	name,
	attempt: 1,
	queue: "default",
	priority: 0,
	acquiredAt: new Date(),
	stalledCount: 0,
});

/** Runs the notice job for `tenant` the way the worker does, without the queue. */
async function runNoticeJob(tenant: Tenant, at = sweepMoment(DateTime.utc())) {
	const job = new PackageNoticeJob();
	job.$hydrate(
		{ tenantId: tenant.id, at: at.toUTC().toISO() as string },
		context("PackageNoticeJob"),
	);
	await job.execute();
}

const createdAt = (tenant: Tenant, at: DateTime) =>
	inTenant(tenant, () =>
		dbClient().rawQuery("update tenants set created_at = ? where id = ?", [
			at.toJSDate(),
			tenant.id,
		]),
	);

const noticesIn = (logs: ReturnType<typeof captureLogs>) =>
	logs
		.everything()
		.filter((args) => args.includes("Package notice would be sent"))
		.map((args) => args[0] as Record<string, unknown>);

test.group("Packages: notices", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.teardown(() => queue.restore());

	test("the notice job logs the due notice for its studio in observe mode, and nothing when none is due", async ({
		assert,
	}) => {
		const ending = await studioWithOwner("notice-ending", "Ending");
		// The trial ends 2.5 days after today's sweep: its 3-day notice fell
		// half a day before it.
		await createdAt(
			ending.tenant,
			sweepMoment(DateTime.utc()).minus({ days: 11, hours: 12 }),
		);
		const fresh = await studioWithOwner("notice-fresh", "Fresh");

		const logs = captureLogs();
		try {
			await runNoticeJob(ending.tenant);
			await runNoticeJob(fresh.tenant);
		} finally {
			logs.restore();
		}

		const notices = noticesIn(logs);
		assert.lengthOf(notices, 1);
		assert.include(notices[0], {
			tenantId: ending.tenant.id,
			notice: "trial_ends_in_3_days",
			state: "trial",
		});
	});

	test("the notice job judges at the sweep's moment, not when it happens to run", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("notice-moment", "Moment");
		// The trial ends at 2026-12-01T00:00Z.
		await createdAt(tenant, DateTime.fromISO("2026-11-17T00:00:00Z"));

		const logs = captureLogs();
		try {
			await runNoticeJob(
				tenant,
				DateTime.fromISO("2026-11-28T03:17:00Z", { zone: "utc" }),
			);
		} finally {
			logs.restore();
		}

		assert.deepEqual(
			noticesIn(logs).map(({ notice }) => notice),
			["trial_ends_in_3_days"],
		);
	});

	test("a studio deleted between the sweep and its job is skipped quietly", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("notice-deleted", "Deleted");
		await inTenant(tenant, () =>
			dbClient().rawQuery(
				"update tenants set deleted_at = now() where id = ?",
				[tenant.id],
			),
		);

		const logs = captureLogs();
		try {
			await runNoticeJob(tenant);
		} finally {
			logs.restore();
		}
		assert.lengthOf(noticesIn(logs), 0);
	});

	test("the sweep queues one notice job per live studio", async ({
		assert,
	}) => {
		const a = await studioWithOwner("notice-sweep-a", "Sweep A");
		const b = await studioWithOwner("notice-sweep-b", "Sweep B");
		const gone = await studioWithOwner("notice-sweep-gone", "Gone");
		await inTenant(gone.tenant, () =>
			dbClient().rawQuery(
				"update tenants set deleted_at = now() where id = ?",
				[gone.tenant.id],
			),
		);
		const fake = queue.fake();

		const sweep = new SweepPackageNoticesJob();
		sweep.$hydrate({}, context("SweepPackageNoticesJob"));
		await sweep.execute();

		const ours = new Set([a.tenant.id, b.tenant.id, gone.tenant.id]);
		const queued = fake
			.getPushedJobs()
			.map(({ job }) => job)
			.filter(({ name }) => name === PackageNoticeJob.name)
			.map(({ payload }) => payload as { tenantId: string; at: string })
			.filter(({ tenantId }) => ours.has(tenantId));
		assert.sameMembers(
			queued.map(({ tenantId }) => tenantId),
			[a.tenant.id, b.tenant.id],
		);
		// Every job of one sweep judges at the same nominal moment.
		const moment = sweepMoment(DateTime.utc()).toUTC().toISO();
		assert.deepEqual([...new Set(queued.map(({ at }) => at))], [moment]);
	});
});
