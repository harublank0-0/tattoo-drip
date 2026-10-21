import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import User from "#models/user";
import { withDbContext, withTransaction } from "#services/db_context";
import {
	makeClient,
	makeInquiry,
	makePayment,
	makeProject,
} from "#tests/helpers/pipeline";
import { assertRowLevelSecurity } from "#tests/helpers/rls";
import { insertRow, sql } from "#tests/helpers/sql";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

let users = 0;
/** A user who receives alerts: staff_alerts points at users, not memberships. */
const member = () =>
	User.create({
		email: `alert-member-${++users}-52@example.com`,
		password: "secret-password",
	});

const inquiryIn = (tenant: { id: string }) =>
	inTenant(tenant, async () => makeInquiry(tenant, await makeClient(tenant)));

const alert = (
	tenantId: string,
	userId: string,
	inquiryId: string | null,
	over: Record<string, unknown> = {},
) => ({
	tenant_id: tenantId,
	user_id: userId,
	kind: "new_inquiry",
	inquiry_id: inquiryId,
	...over,
});

test.group("staff_alerts table", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("row-level security", async ({ assert }) => {
		await assertRowLevelSecurity(assert, "staff_alerts", async (tenant) =>
			alert(tenant.id, (await member()).id, (await inquiryIn(tenant)).id),
		);
	});

	test("an alert names an inquiry of its own studio, once per member", async ({
		assert,
	}) => {
		const { tenant: a, owner } = await studioWithOwner("alerts-a-52");
		const { tenant: b } = await studioWithOwner("alerts-b-52");
		const mine = await inquiryIn(a);
		const theirs = await inquiryIn(b);
		const rejects = (values: Record<string, unknown>, message: RegExp) =>
			assert.rejects(
				() =>
					withTransaction((inner) => insertRow(inner, "staff_alerts", values)),
				message,
			);

		await withDbContext({ tenantId: a.id }, async (trx) => {
			await rejects(
				alert(a.id, owner.id, theirs.id),
				/staff_alerts_tenant_id_inquiry_id_foreign/,
			);
			await rejects(
				alert(a.id, owner.id, null),
				/staff_alerts_subject_matches_kind/,
			);
			await rejects(
				alert(a.id, owner.id, mine.id, { kind: "hello" }),
				/staff_alerts_kind_check/,
			);
			await insertRow(trx, "staff_alerts", alert(a.id, owner.id, mine.id));
			await rejects(
				alert(a.id, owner.id, mine.id),
				/staff_alerts_user_id_inquiry_id_unique/,
			);
		});
	});

	test("a deposit-proof alert names a payment of its own studio and project, once per member", async ({
		assert,
	}) => {
		const { tenant: a, owner } = await studioWithOwner("proof-table-a-88");
		const { tenant: b } = await studioWithOwner("proof-table-b-88");
		const paymentIn = (tenant: { id: string }) =>
			inTenant(tenant, async () =>
				makePayment(
					tenant,
					await makeProject(tenant, await makeClient(tenant)),
				),
			);
		const mine = await paymentIn(a);
		// A payment of another project in the same studio.
		const another = await paymentIn(a);
		const theirs = await paymentIn(b);
		const inquiry = await inquiryIn(a);
		const proof = (
			payment: { id: string; projectId: string },
			over: Record<string, unknown> = {},
		) =>
			alert(a.id, owner.id, null, {
				kind: "deposit_proof",
				project_id: payment.projectId,
				payment_id: payment.id,
				...over,
			});
		const rejects = (values: Record<string, unknown>, message: RegExp) =>
			assert.rejects(
				() =>
					withTransaction((inner) => insertRow(inner, "staff_alerts", values)),
				message,
			);

		await withDbContext({ tenantId: a.id }, async (trx) => {
			await rejects(proof(theirs), /staff_alerts_payment_foreign/);
			await rejects(
				proof(mine, { project_id: another.projectId }),
				/staff_alerts_payment_foreign/,
			);
			await rejects(
				proof(mine, { payment_id: null }),
				/staff_alerts_subject_matches_kind/,
			);
			await rejects(
				proof(mine, { project_id: null }),
				/staff_alerts_subject_matches_kind/,
			);
			await rejects(
				proof(mine, { inquiry_id: inquiry.id }),
				/staff_alerts_subject_matches_kind/,
			);
			await rejects(
				alert(a.id, owner.id, inquiry.id, {
					project_id: mine.projectId,
					payment_id: mine.id,
				}),
				/staff_alerts_subject_matches_kind/,
			);
			await insertRow(trx, "staff_alerts", proof(mine));
			await rejects(proof(mine), /staff_alerts_user_id_payment_id_unique/);
			// Another payment (the next screenshot) is another alert.
			await insertRow(trx, "staff_alerts", proof(another));
		});
	});

	test("deleting the member's account removes their alerts", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("alerts-gone-52");
		const gone = await member();
		const inquiry = await inquiryIn(tenant);
		await withDbContext({ tenantId: tenant.id }, (trx) =>
			insertRow(trx, "staff_alerts", alert(tenant.id, gone.id, inquiry.id)),
		);

		await gone.delete();

		const { rows } = await sql(
			{ tenantId: tenant.id },
			"select count(*)::int as n from staff_alerts",
		);
		assert.equal(rows[0].n, 0);
	});
});
