import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import User from "#models/user";
import { withDbContext, withTransaction } from "#services/db_context";
import {
	makeArtist,
	makeClient,
	makePayment,
	makeProject,
	makeSession,
} from "#tests/helpers/pipeline";
import { assertRowLevelSecurity } from "#tests/helpers/rls";
import { idOf, insertRow, sql } from "#tests/helpers/sql";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

/** A closed project with a refund and a session, in `tenant`. */
const seeded = (tenant: { id: string }) =>
	inTenant(tenant, async () => {
		const client = await makeClient(tenant);
		const project = await makeProject(tenant, client, { status: "cancelled" });
		const other = await makeProject(tenant, client, { status: "cancelled" });
		const refund = await makePayment(tenant, project, {
			kind: "refund",
			amount: -100_000,
		});
		const otherRefund = await makePayment(tenant, other, {
			kind: "refund",
			amount: -100_000,
		});
		const session = await makeSession(
			tenant,
			project,
			await makeArtist(tenant),
		);
		return { project, other, refund, otherRefund, session };
	});

const outcome = (
	tenantId: string,
	projectId: string,
	over: Record<string, unknown> = {},
) => ({
	tenant_id: tenantId,
	project_id: projectId,
	outcome: "kept",
	amount: 300_000,
	currency: "NPR",
	...over,
});

test.group("deposit_outcomes table", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("row-level security", async ({ assert }) => {
		// The seed runs more than once per tenant: a fresh project each time,
		// nothing with a fixed slug or time.
		await assertRowLevelSecurity(assert, "deposit_outcomes", async (tenant) => {
			const project = await inTenant(tenant, async () =>
				makeProject(tenant, await makeClient(tenant), { status: "cancelled" }),
			);
			return outcome(tenant.id, project.id);
		});
	});

	test("an outcome belongs to its own tenant's project, and so do its refund and session", async ({
		assert,
	}) => {
		const { tenant: a } = await studioWithOwner("outcome-a-66", "A");
		const { tenant: b } = await studioWithOwner("outcome-b-66", "B");
		const mine = await seeded(a);
		const theirs = await seeded(b);
		const rejects = (values: Record<string, unknown>, message: RegExp) =>
			assert.rejects(
				() =>
					withTransaction((inner) =>
						insertRow(inner, "deposit_outcomes", values),
					),
				message,
			);

		await withDbContext({ tenantId: a.id }, async () => {
			await rejects(
				outcome(a.id, theirs.project.id),
				/deposit_outcomes_tenant_id_project_id_foreign/,
			);
			await rejects(
				outcome(a.id, mine.project.id, {
					outcome: "refunded",
					refund_payment_id: mine.otherRefund.id,
				}),
				/deposit_outcomes_refund_payment_foreign/,
			);
			await rejects(
				outcome(a.id, mine.other.id, { session_id: mine.session.id }),
				/deposit_outcomes_session_foreign/,
			);
		});
	});

	test("refunded goes with its refund, moved with a session, and the amount is positive", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("outcome-rules-66", "Rules");
		const { project, refund, session } = await seeded(tenant);
		const rejects = (values: Record<string, unknown>, message: RegExp) =>
			assert.rejects(
				() =>
					withTransaction((inner) =>
						insertRow(inner, "deposit_outcomes", values),
					),
				message,
			);

		await withDbContext({ tenantId: tenant.id }, async (trx) => {
			await rejects(
				outcome(tenant.id, project.id, { outcome: "refunded" }),
				/deposit_outcomes_refund_matches/,
			);
			await rejects(
				outcome(tenant.id, project.id, { refund_payment_id: refund.id }),
				/deposit_outcomes_refund_matches/,
			);
			await rejects(
				outcome(tenant.id, project.id, { outcome: "moved" }),
				/deposit_outcomes_moved_needs_session/,
			);
			await rejects(
				outcome(tenant.id, project.id, { amount: 0 }),
				/deposit_outcomes_amount_positive/,
			);
			await rejects(
				outcome(tenant.id, project.id, { outcome: "lost" }),
				/deposit_outcomes_outcome_check/,
			);

			await insertRow(
				trx,
				"deposit_outcomes",
				outcome(tenant.id, project.id, {
					outcome: "refunded",
					refund_payment_id: refund.id,
				}),
			);
			await insertRow(
				trx,
				"deposit_outcomes",
				outcome(tenant.id, project.id, {
					outcome: "moved",
					session_id: session.id,
				}),
			);
		});
	});

	test("one outcome per project close, one per session, and a refund is used once", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("outcome-once-66", "Once");
		const { project, refund, session } = await seeded(tenant);
		const rejects = (values: Record<string, unknown>, message: RegExp) =>
			assert.rejects(
				() =>
					withTransaction((inner) =>
						insertRow(inner, "deposit_outcomes", values),
					),
				message,
			);

		await withDbContext({ tenantId: tenant.id }, async (trx) => {
			await insertRow(
				trx,
				"deposit_outcomes",
				outcome(tenant.id, project.id, {
					outcome: "refunded",
					refund_payment_id: refund.id,
				}),
			);
			await rejects(
				outcome(tenant.id, project.id),
				/deposit_outcomes_project_close_unique/,
			);
			await insertRow(
				trx,
				"deposit_outcomes",
				outcome(tenant.id, project.id, { session_id: session.id }),
			);
			await rejects(
				outcome(tenant.id, project.id, { session_id: session.id }),
				/deposit_outcomes_session_unique/,
			);
			await rejects(
				outcome(tenant.id, project.id, {
					outcome: "refunded",
					refund_payment_id: refund.id,
					session_id: session.id,
				}),
				/deposit_outcomes_(session|refund_payment)_unique/,
			);
		});
	});

	test("deleting the recorder's account keeps the outcome and clears who recorded it", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("outcome-user-66", "User");
		const { project } = await seeded(tenant);
		const recorder = await User.create({
			email: "recorder-66@example.com",
			password: "secret-password",
		});
		const id = await withDbContext({ tenantId: tenant.id }, async (trx) =>
			idOf(
				await insertRow(
					trx,
					"deposit_outcomes",
					outcome(tenant.id, project.id, {
						recorded_by_user_id: recorder.id,
					}),
				),
			),
		);

		await recorder.delete();

		const rows = await sql(
			{ tenantId: tenant.id },
			"select recorded_by_user_id from deposit_outcomes where id = ?",
			[id],
		);
		assert.deepEqual(rows.rows, [{ recorded_by_user_id: null }]);
	});
});
