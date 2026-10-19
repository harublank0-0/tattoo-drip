import { randomUUID } from "node:crypto";
import { mock } from "node:test";
import logger from "@adonisjs/core/services/logger";
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import DepositProofAlertJob from "#modules/payments/jobs/deposit_proof_alert_job";
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
	});
});
