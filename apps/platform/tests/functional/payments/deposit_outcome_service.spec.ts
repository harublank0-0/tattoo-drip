import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import { PaymentRuleError } from "#modules/payments/errors";
import DepositOutcome from "#modules/payments/models/deposit_outcome";
import Payment from "#modules/payments/models/payment";
import type TattooProject from "#modules/projects/models/tattoo_project";
import { ownerMember, paymentServices } from "#tests/helpers/payments";
import {
	makeClient,
	makePayment,
	makeProject,
	makeQuote,
} from "#tests/helpers/pipeline";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";

const { payments } = paymentServices();

async function reasonOf(work: () => Promise<unknown>) {
	try {
		await work();
		return null;
	} catch (error) {
		if (error instanceof PaymentRuleError) return error.reason;
		throw error;
	}
}

/** A project in `status` with the default quote and, unless `held` is 0, a verified deposit of `held` paisa. */
async function closed(
	slug: string,
	status: TattooProject["status"] = "cancelled",
	held = 300_000,
) {
	const { owner, tenant } = await studioWithOwner(slug, "Black Needle");
	const project = await inTenant(tenant, async () => {
		const made = await makeProject(tenant, await makeClient(tenant), {
			status,
		});
		await makeQuote(tenant, made);
		if (held > 0) {
			await makePayment(tenant, made, {
				amount: held,
				status: "verified",
				verifiedAt: DateTime.utc(),
			});
		}
		return made;
	});
	return { owner, tenant, member: ownerMember(owner), project };
}

test.group("PaymentService.recordOutcome", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("kept records the deposit money held, and nothing more is needed", async ({
		assert,
	}) => {
		const { owner, tenant, member, project } = await closed("kept-66");

		const outcome = await inTenant(tenant, () =>
			payments.recordOutcome(tenant, member, project, {
				outcome: "kept",
				note: "No-show policy",
			}),
		);

		assert.deepEqual(
			[
				outcome.outcome,
				outcome.amount,
				outcome.currency,
				outcome.refundPaymentId,
				outcome.sessionId,
				outcome.recordedByUserId,
				outcome.note,
			],
			["kept", 300_000, "NPR", null, null, owner.id, "No-show policy"],
		);
		const money = await inTenant(tenant, () =>
			payments.forProject(tenant, project),
		);
		assert.isFalse(money.outcomeNeeded);
		assert.equal(money.outcome?.id, outcome.id);
	});

	test("refunded records a refund up to the deposit held and names it; the rest is kept", async ({
		assert,
	}) => {
		const { tenant, member, project } = await closed("refunded-66");

		const outcome = await inTenant(tenant, () =>
			payments.recordOutcome(tenant, member, project, {
				outcome: "refunded",
				amount: 200_000,
				method: "esewa",
				note: "Half back, as agreed",
			}),
		);

		const refund = await inTenant(tenant, () =>
			Payment.findOrFail(outcome.refundPaymentId ?? ""),
		);
		assert.deepEqual(
			[
				refund.kind,
				refund.amount,
				refund.method,
				refund.status,
				refund.projectId,
			],
			["refund", -200_000, "esewa", "verified", project.id],
		);
		assert.deepEqual([outcome.outcome, outcome.amount], ["refunded", 300_000]);
	});

	test("more than the deposit held is refused, and nothing is recorded", async ({
		assert,
	}) => {
		const { tenant, member, project } = await closed("too-much-66");

		try {
			await inTenant(tenant, () =>
				payments.recordOutcome(tenant, member, project, {
					outcome: "refunded",
					amount: 300_001,
					method: "cash",
					note: null,
				}),
			);
			assert.fail("refunding more than the deposit held must be refused");
		} catch (error) {
			assert.instanceOf(error, PaymentRuleError);
			assert.equal((error as PaymentRuleError).reason, "refund_too_large");
			assert.equal((error as PaymentRuleError).limit, 300_000);
		}
		await inTenant(tenant, async () => {
			assert.lengthOf(
				await DepositOutcome.query().where("project_id", project.id),
				0,
			);
			assert.lengthOf(
				await Payment.query()
					.where("project_id", project.id)
					.where("kind", "refund"),
				0,
			);
		});
	});

	test("no outcome for an open project, one without deposit money, or a second time", async ({
		assert,
	}) => {
		const open = await closed("open-66", "booked");
		const empty = await closed("empty-66", "cancelled", 0);
		const twice = await closed("twice-out-66");
		const record = (setup: Awaited<ReturnType<typeof closed>>) =>
			reasonOf(() =>
				inTenant(setup.tenant, () =>
					payments.recordOutcome(setup.tenant, setup.member, setup.project, {
						outcome: "kept",
						note: null,
					}),
				),
			);

		assert.equal(await record(open), "no_outcome_needed");
		assert.equal(await record(empty), "no_outcome_needed");
		assert.isNull(await record(twice));
		assert.equal(await record(twice), "no_outcome_needed");
	});

	test("a deposit refunded in full before the close needs no outcome, and can't be refunded again", async ({
		assert,
	}) => {
		const { tenant, member, project } = await closed("refunded-first-66");
		await inTenant(tenant, () =>
			makePayment(tenant, project, {
				kind: "refund",
				amount: -300_000,
				status: "verified",
				verifiedAt: DateTime.utc(),
			}),
		);

		const money = await inTenant(tenant, () =>
			payments.forProject(tenant, project),
		);
		assert.equal(money.depositHeld, 300_000);
		assert.equal(money.depositSettleable, 0);
		assert.isFalse(money.outcomeNeeded);
		for (const input of [
			{ outcome: "kept", note: null },
			{ outcome: "refunded", amount: 300_000, method: "cash", note: null },
		] as const) {
			assert.equal(
				await reasonOf(() =>
					inTenant(tenant, () =>
						payments.recordOutcome(tenant, member, project, input),
					),
				),
				"no_outcome_needed",
			);
		}
		await inTenant(tenant, async () => {
			assert.lengthOf(
				await DepositOutcome.query().where("project_id", project.id),
				0,
			);
			assert.lengthOf(
				await Payment.query()
					.where("project_id", project.id)
					.where("kind", "refund"),
				1,
			);
		});
	});

	test("after a part was refunded, the outcome covers only what the project still holds", async ({
		assert,
	}) => {
		const { tenant, member, project } = await closed("partial-first-66");
		await inTenant(tenant, () =>
			makePayment(tenant, project, {
				kind: "refund",
				amount: -200_000,
				status: "verified",
				verifiedAt: DateTime.utc(),
			}),
		);

		const money = await inTenant(tenant, () =>
			payments.forProject(tenant, project),
		);
		assert.deepInclude(money, {
			depositHeld: 300_000,
			depositSettleable: 100_000,
			outcomeNeeded: true,
		});
		try {
			await inTenant(tenant, () =>
				payments.recordOutcome(tenant, member, project, {
					outcome: "refunded",
					amount: 100_001,
					method: "cash",
					note: null,
				}),
			);
			assert.fail("refunding more than the project holds must be refused");
		} catch (error) {
			assert.instanceOf(error, PaymentRuleError);
			assert.equal((error as PaymentRuleError).reason, "refund_too_large");
			assert.equal((error as PaymentRuleError).limit, 100_000);
		}

		const outcome = await inTenant(tenant, () =>
			payments.recordOutcome(tenant, member, project, {
				outcome: "refunded",
				amount: 100_000,
				method: "cash",
				note: null,
			}),
		);
		assert.deepEqual([outcome.outcome, outcome.amount], ["refunded", 100_000]);
		const after = await inTenant(tenant, () =>
			payments.forProject(tenant, project),
		);
		assert.equal(after.balance.paid, 0n);
	});

	test("kept after a part was refunded records what is held, not the whole deposit", async ({
		assert,
	}) => {
		const { tenant, member, project } = await closed("kept-partial-66");
		await inTenant(tenant, () =>
			makePayment(tenant, project, {
				kind: "refund",
				amount: -200_000,
				status: "verified",
				verifiedAt: DateTime.utc(),
			}),
		);

		const outcome = await inTenant(tenant, () =>
			payments.recordOutcome(tenant, member, project, {
				outcome: "kept",
				note: null,
			}),
		);

		assert.equal(outcome.amount, 100_000);
	});

	test("payments that are not deposit money are never offered back through the outcome", async ({
		assert,
	}) => {
		const { tenant, member, project } = await closed("session-money-66");
		await inTenant(tenant, () =>
			makePayment(tenant, project, {
				kind: "session",
				amount: 500_000,
				status: "verified",
				verifiedAt: DateTime.utc(),
			}),
		);

		const refuse = (amount: number) =>
			inTenant(tenant, () =>
				payments.recordOutcome(tenant, member, project, {
					outcome: "refunded",
					amount,
					method: "cash",
					note: null,
				}),
			);
		assert.equal(await reasonOf(() => refuse(300_001)), "refund_too_large");
		const outcome = await refuse(300_000);
		assert.equal(outcome.amount, 300_000);
	});

	test("after the outcome a plain refund works again", async ({ assert }) => {
		const { tenant, member, project } = await closed("after-66");
		await inTenant(tenant, () =>
			payments.recordOutcome(tenant, member, project, {
				outcome: "kept",
				note: null,
			}),
		);

		const refund = await inTenant(tenant, () =>
			payments.refund(tenant, member, project, {
				method: "cash",
				amount: 50_000,
				note: null,
			}),
		);
		assert.equal(refund.amount, -50_000);
	});

	test("an artist can't record an outcome", async ({ assert }) => {
		const { tenant, project } = await closed("outcome-artist-66");
		const asha = await artistIn(tenant, "asha@outcome-66.example");

		await assert.rejects(
			() =>
				inTenant(tenant, () =>
					payments.recordOutcome(
						tenant,
						{ userId: asha.id, role: "artist" },
						project,
						{ outcome: "kept", note: null },
					),
				),
			/Row not found/,
		);
	});
});
