import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import User from "#models/user";
import Payment, {
	PAYMENT_KINDS,
	PAYMENT_STATUSES,
} from "#modules/payments/models/payment";
import { PAYMENT_METHOD_KINDS } from "#modules/payments/models/payment_method";
import { withDbContext, withTransaction } from "#services/db_context";
import { makeClient, makePayment, makeProject } from "#tests/helpers/pipeline";
import { assertRowLevelSecurity } from "#tests/helpers/rls";
import { idOf, insertRow, updateRow } from "#tests/helpers/sql";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

const newPayment = (
	tenantId: string,
	projectId: string,
	over: Record<string, unknown> = {},
) => ({
	tenant_id: tenantId,
	project_id: projectId,
	kind: "deposit",
	amount: 300_000,
	method: "cash",
	...over,
});

/** The columns of a payment that has been verified by `userId`. */
const verified = (userId: string, over: Record<string, unknown> = {}) => ({
	status: "verified",
	verified_at: new Date(),
	verified_by_user_id: userId,
	...over,
});

const projectIn = (tenant: { id: string }) =>
	inTenant(tenant, async () => makeProject(tenant, await makeClient(tenant)));

async function twoTenants() {
	const { tenant: a, owner } = await studioWithOwner("studio-a", "Studio A");
	const { tenant: b } = await studioWithOwner("studio-b", "Studio B");
	return {
		a,
		b,
		owner,
		mine: await projectIn(a),
		other: await projectIn(a),
		theirs: await projectIn(b),
	};
}

test.group("payments table", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a payment links only to its own tenant's project, which then cannot be hard-deleted", async ({
		assert,
	}) => {
		const { a, mine, theirs } = await twoTenants();

		await withDbContext({ tenantId: a.id }, async (trx) => {
			await assert.rejects(
				() =>
					withTransaction((inner) =>
						insertRow(inner, "payments", newPayment(a.id, theirs.id)),
					),
				/payments_tenant_id_project_id_foreign/,
			);
			await insertRow(trx, "payments", newPayment(a.id, mine.id));
			await assert.rejects(
				() =>
					withTransaction((inner) =>
						inner.rawQuery("delete from tattoo_projects where id = ?", [
							mine.id,
						]),
					),
				/payments_tenant_id_project_id_foreign/,
			);
		});
	});

	test("kind, method and status only take their listed values", async ({
		assert,
	}) => {
		const { a, mine, owner } = await twoTenants();
		const rejects = (over: Record<string, unknown>, message: RegExp) =>
			assert.rejects(
				() =>
					withTransaction((inner) =>
						insertRow(inner, "payments", newPayment(a.id, mine.id, over)),
					),
				message,
			);

		await withDbContext({ tenantId: a.id }, async () => {
			await rejects({ kind: "bonus" }, /payments_kind_check/);
			await rejects({ method: "paypal" }, /payments_method_check/);
			// A decision time keeps payments_verified_matches_status satisfied, so
			// the status check is the one that fails.
			await rejects(
				verified(owner.id, { status: "paid" }),
				/payments_status_check/,
			);
		});
	});

	test("a refund is negative, a correction is non-zero, every other kind is positive", async ({
		assert,
	}) => {
		const { a, mine } = await twoTenants();
		const cases: [string, number, boolean][] = [
			["deposit", 1000, true],
			["deposit", 0, false],
			["deposit", -1000, false],
			["session", 500, true],
			["balance", 500, true],
			["refund", -500, true],
			["refund", 500, false],
			["refund", 0, false],
			["correction", -500, true],
			["correction", 500, true],
			["correction", 0, false],
		];

		await withDbContext({ tenantId: a.id }, async () => {
			for (const [kind, amount, allowed] of cases) {
				const insert = () =>
					withTransaction((inner) =>
						insertRow(
							inner,
							"payments",
							newPayment(a.id, mine.id, { kind, amount }),
						),
					);
				if (allowed) await insert();
				else await assert.rejects(insert, /payments_amount_sign/);
			}
		});
	});

	test("a decision time goes with a decided status, and only a decided payment has a verifier", async ({
		assert,
	}) => {
		const { a, mine, owner } = await twoTenants();
		const rejects = (over: Record<string, unknown>, message: RegExp) =>
			assert.rejects(
				() =>
					withTransaction((inner) =>
						insertRow(inner, "payments", newPayment(a.id, mine.id, over)),
					),
				message,
			);

		await withDbContext({ tenantId: a.id }, async (trx) => {
			await rejects(
				{ verified_at: new Date() },
				/payments_verified_matches_status/,
			);
			await rejects({ status: "verified" }, /payments_verified_matches_status/);
			await rejects(
				{ verified_by_user_id: owner.id },
				/payments_unverified_has_no_verifier/,
			);
			await insertRow(
				trx,
				"payments",
				newPayment(a.id, mine.id, verified(owner.id)),
			);
			// A desk payment can be decided without a named verifier.
			await insertRow(
				trx,
				"payments",
				newPayment(a.id, mine.id, {
					status: "rejected",
					verified_at: new Date(),
				}),
			);
		});
	});

	test("the proof columns are all set or all null", async ({ assert }) => {
		const { a, mine } = await twoTenants();

		await withDbContext({ tenantId: a.id }, async (trx) => {
			await assert.rejects(
				() =>
					withTransaction((inner) =>
						insertRow(
							inner,
							"payments",
							newPayment(a.id, mine.id, { proof_image_key: "k.webp" }),
						),
					),
				/payments_proof_all_or_none/,
			);
			await insertRow(
				trx,
				"payments",
				newPayment(a.id, mine.id, {
					proof_image_key: "k.webp",
					proof_image_width: 800,
					proof_image_height: 600,
				}),
			);
		});
	});

	test("the guard rejects every DELETE", async ({ assert }) => {
		const { a, mine } = await twoTenants();

		await withDbContext({ tenantId: a.id }, async (trx) => {
			const id = idOf(
				await insertRow(trx, "payments", newPayment(a.id, mine.id)),
			);
			await assert.rejects(
				() =>
					withTransaction((inner) =>
						inner.rawQuery("delete from payments where id = ?", [id]),
					),
				/payments_guard: payments are never deleted/,
			);
		});
	});

	test("the guard freezes the money facts", async ({ assert }) => {
		const { a, b, mine, other } = await twoTenants();
		const frozen: [string, unknown][] = [
			["tenant_id", b.id],
			["project_id", other.id],
			["kind", "session"],
			["amount", 1],
			["currency", "USD"],
			["method", "bank"],
			["created_at", new Date("2020-01-01")],
		];

		await withDbContext({ tenantId: a.id }, async (trx) => {
			const id = idOf(
				await insertRow(trx, "payments", newPayment(a.id, mine.id)),
			);
			for (const [column, value] of frozen) {
				await assert.rejects(
					() =>
						withTransaction((inner) =>
							updateRow(inner, "payments", id, { [column]: value }),
						),
					new RegExp(`payments_guard: ${column} cannot change`),
				);
			}
		});
	});

	test("a submitted payment can be verified or rejected, and then it is final", async ({
		assert,
	}) => {
		const { a, mine, owner } = await twoTenants();
		const stranger = await User.create({
			email: "stranger@example.com",
			password: "secret-password",
		});
		const rejects = (
			id: string,
			set: Record<string, unknown>,
			message: RegExp,
		) =>
			assert.rejects(
				() => withTransaction((inner) => updateRow(inner, "payments", id, set)),
				message,
			);

		await withDbContext({ tenantId: a.id }, async (trx) => {
			const accepted = idOf(
				await insertRow(trx, "payments", newPayment(a.id, mine.id)),
			);
			const turnedDown = idOf(
				await insertRow(trx, "payments", newPayment(a.id, mine.id)),
			);

			await updateRow(trx, "payments", accepted, verified(owner.id));
			await updateRow(
				trx,
				"payments",
				turnedDown,
				verified(owner.id, { status: "rejected" }),
			);

			await rejects(
				accepted,
				{ status: "rejected" },
				/payments_guard: status cannot change/,
			);
			await rejects(
				turnedDown,
				{ status: "submitted", verified_at: null, verified_by_user_id: null },
				/payments_guard: status cannot change/,
			);
			await rejects(
				accepted,
				{ verified_at: new Date("2020-01-01") },
				/payments_guard: verified_at cannot change/,
			);
			await rejects(
				accepted,
				{ verified_by_user_id: stranger.id },
				/payments_guard: verified_by_user_id cannot change/,
			);
		});
	});

	test("the proof can be cleared but never replaced", async ({ assert }) => {
		const { a, mine } = await twoTenants();
		const proof = {
			proof_image_key: "k.webp",
			proof_image_width: 800,
			proof_image_height: 600,
		};

		await withDbContext({ tenantId: a.id }, async (trx) => {
			const id = idOf(
				await insertRow(trx, "payments", newPayment(a.id, mine.id, proof)),
			);

			await assert.rejects(
				() =>
					withTransaction((inner) =>
						updateRow(inner, "payments", id, {
							proof_image_key: "other.webp",
							proof_image_width: 10,
							proof_image_height: 10,
						}),
					),
				/payments_guard: proof can only be cleared/,
			);
			await updateRow(trx, "payments", id, {
				proof_image_key: null,
				proof_image_width: null,
				proof_image_height: null,
			});
			await assert.rejects(
				() =>
					withTransaction((inner) => updateRow(inner, "payments", id, proof)),
				/payments_guard: proof can only be cleared/,
			);
		});
	});

	test("deleting the verifier's account keeps the decided payment and clears the verifier", async ({
		assert,
	}) => {
		const { a, mine } = await twoTenants();
		const verifier = await User.create({
			email: "verifier@example.com",
			password: "secret-password",
		});

		await withDbContext({ tenantId: a.id }, async (trx) => {
			const id = idOf(
				await insertRow(
					trx,
					"payments",
					newPayment(a.id, mine.id, verified(verifier.id)),
				),
			);

			await trx.rawQuery("delete from users where id = ?", [verifier.id]);

			const { rows } = await trx.rawQuery(
				"select status, verified_by_user_id from payments where id = ?",
				[id],
			);
			assert.equal(rows[0].status, "verified");
			assert.isNull(rows[0].verified_by_user_id);
		});
	});

	test("row-level security", async ({ assert }) => {
		await assertRowLevelSecurity(
			assert,
			"payments",
			async (tenant) => newPayment(tenant.id, (await projectIn(tenant)).id),
			// The guard trigger fires before the policy's WITH CHECK and names the column.
			/payments_guard: tenant_id cannot change/,
		);
	});
});

test.group("Payment model", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("verifying and rejecting go through save() and pass the guard", async ({
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const project = await makeProject(tenant, await makeClient(tenant));
			const toVerify = await makePayment(tenant, project);
			const toReject = await makePayment(tenant, project);

			toVerify.merge({
				status: "verified",
				verifiedAt: DateTime.utc(),
				verifiedByUserId: owner.id,
			});
			await toVerify.save();
			toReject.merge({
				status: "rejected",
				verifiedAt: DateTime.utc(),
				verifiedByUserId: owner.id,
			});
			await toReject.save();

			assert.equal((await Payment.findOrFail(toVerify.id)).status, "verified");
			assert.equal((await Payment.findOrFail(toReject.id)).status, "rejected");
		});
	});

	test("a model delete is refused and Payment has no soft delete", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const payment = await makePayment(
				tenant,
				await makeProject(tenant, await makeClient(tenant)),
			);

			assert.isUndefined(
				(Payment.prototype as unknown as Record<string, unknown>).softDelete,
			);
			await assert.rejects(
				() => withTransaction(() => payment.delete()),
				/payments_guard: payments are never deleted/,
			);
		});
	});

	test("every kind, status and method in the model is accepted by the database", async ({
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const project = await makeProject(tenant, await makeClient(tenant));
			for (const kind of PAYMENT_KINDS) {
				const negative = kind === "refund" || kind === "correction";
				await makePayment(tenant, project, {
					kind,
					amount: negative ? -100_000 : 100_000,
				});
			}
			for (const status of PAYMENT_STATUSES) {
				await makePayment(
					tenant,
					project,
					status === "submitted"
						? { status }
						: {
								status,
								verifiedAt: DateTime.utc(),
								verifiedByUserId: owner.id,
							},
				);
			}
			for (const method of PAYMENT_METHOD_KINDS) {
				await makePayment(tenant, project, { method });
			}
			assert.lengthOf(
				await Payment.query().where("tenant_id", tenant.id),
				PAYMENT_KINDS.length +
					PAYMENT_STATUSES.length +
					PAYMENT_METHOD_KINDS.length,
			);
		});
	});
});
