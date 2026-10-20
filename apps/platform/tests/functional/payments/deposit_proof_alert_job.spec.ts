import { randomUUID } from "node:crypto";
import { mock } from "node:test";
import logger from "@adonisjs/core/services/logger";
import testUtils from "@adonisjs/core/services/test_utils";
import queue from "@adonisjs/queue/services/main";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import StaffAlert from "#modules/notifications/models/staff_alert";
import DepositProofAlertJob from "#modules/payments/jobs/deposit_proof_alert_job";
import TattooProject from "#modules/projects/models/tattoo_project";
import { makeClient, makePayment, makeProject } from "#tests/helpers/pipeline";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

const MESSAGE = "Deposit proof received.";

/** Runs the job the way the worker does and returns what it logged with MESSAGE. */
async function run(payload: { tenantId: string; paymentId: string }) {
	const job = new DepositProofAlertJob();
	job.$hydrate(payload, {
		jobId: "deposit-proof-alert-spec",
		name: "DepositProofAlertJob",
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

const paymentIn = (
	tenant: { id: string },
	over: Parameters<typeof makePayment>[2] = {},
) =>
	inTenant(tenant, async () => {
		const project = await makeProject(tenant, await makeClient(tenant), {
			status: "deposit_pending",
		});
		return makePayment(tenant, project, {
			method: "esewa",
			proofImageKey: `tenants/${tenant.id}/payment_proof/receipt.png`,
			proofImageWidth: 300,
			proofImageHeight: 200,
			...over,
		});
	});

test.group("DepositProofAlertJob", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.teardown(() => queue.restore());

	test("logs ids only for a proof that waits: no amount, key or link", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("alert-proof-65");
		const payment = await paymentIn(tenant);

		const logged = await run({ tenantId: tenant.id, paymentId: payment.id });

		assert.deepEqual(logged, [
			[
				{
					tenantId: tenant.id,
					projectId: payment.projectId,
					paymentId: payment.id,
				},
				MESSAGE,
			],
		]);
	});

	test("a decided, missing or other studio's payment needs no alert", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("alert-proof-a-65");
		const { tenant: other } = await studioWithOwner("alert-proof-b-65");
		const decided = await paymentIn(tenant, {
			status: "rejected",
			verifiedAt: DateTime.utc(),
		});
		const theirs = await paymentIn(other);

		for (const paymentId of [decided.id, randomUUID(), theirs.id]) {
			assert.deepEqual(
				await run({ tenantId: tenant.id, paymentId }),
				[],
				paymentId,
			);
		}
		// Another studio's payment makes no alert in either studio (TAT-88).
		for (const studio of [tenant, other]) {
			assert.lengthOf(await inTenant(studio, () => StaffAlert.query()), 0);
		}
	});

	test("alerts the studio's owner through AlertService, once however often it runs", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("alert-proof-job-88");
		const payment = await paymentIn(tenant);
		const fake = queue.fake();

		await run({ tenantId: tenant.id, paymentId: payment.id });
		await run({ tenantId: tenant.id, paymentId: payment.id });

		const rows = await inTenant(tenant, () =>
			StaffAlert.query().where("payment_id", payment.id),
		);
		assert.deepEqual(
			rows.map(({ userId, kind, projectId }) => [userId, kind, projectId]),
			[[owner.id, "deposit_proof", payment.projectId]],
		);
		assert.lengthOf(
			fake.getPushedJobs().filter(({ job }) => job.name === "SendMailJob"),
			1,
		);
	});

	test("a deleted project's or a decided payment's proof alerts nobody", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("alert-proof-gone-88");
		const orphan = await paymentIn(tenant);
		await inTenant(tenant, async () =>
			(await TattooProject.findOrFail(orphan.projectId)).softDelete(),
		);
		const decided = await paymentIn(tenant, {
			status: "verified",
			verifiedAt: DateTime.utc(),
		});

		for (const paymentId of [orphan.id, decided.id]) {
			await run({ tenantId: tenant.id, paymentId });
		}

		assert.lengthOf(await inTenant(tenant, () => StaffAlert.query()), 0);
	});
});
