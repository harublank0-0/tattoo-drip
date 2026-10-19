import { randomUUID } from "node:crypto";
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import {
	REFUSE_APPLY_OVER_CORRECTIONS,
	REFUSE_ROLLBACK_OVER_CORRECTIONS,
} from "#database/migrations/1791660000000_add_corrections_and_notes_to_payments";
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

		await withDbContext({ tenantId: a.id }, async (trx) => {
			for (const [kind, amount, allowed] of cases) {
				const target =
					kind === "correction"
						? {
								corrects_payment_id: idOf(
									await insertRow(trx, "payments", newPayment(a.id, mine.id)),
								),
							}
						: {};
				const insert = () =>
					withTransaction((inner) =>
						insertRow(
							inner,
							"payments",
							newPayment(a.id, mine.id, { kind, amount, ...target }),
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

	test("a decided payment can still be updated when the verifier is left alone", async ({
		assert,
	}) => {
		const { a, mine, owner } = await twoTenants();
		const proof = {
			proof_image_key: "k.webp",
			proof_image_width: 800,
			proof_image_height: 600,
		};

		await withDbContext({ tenantId: a.id }, async (trx) => {
			for (const status of ["verified", "rejected"]) {
				const id = idOf(
					await insertRow(
						trx,
						"payments",
						newPayment(a.id, mine.id, verified(owner.id, { status, ...proof })),
					),
				);

				await updateRow(trx, "payments", id, { updated_at: new Date() });
				// Writing the verifier's own id back is no change.
				await updateRow(trx, "payments", id, {
					verified_by_user_id: owner.id,
				});
				// The privacy deletion's proof clear on a decided payment.
				await updateRow(trx, "payments", id, {
					proof_image_key: null,
					proof_image_width: null,
					proof_image_height: null,
				});

				const { rows } = await trx.rawQuery(
					"select status, verified_by_user_id, proof_image_key from payments where id = ?",
					[id],
				);
				assert.equal(rows[0].status, status);
				assert.equal(rows[0].verified_by_user_id, owner.id);
				assert.isNull(rows[0].proof_image_key);
			}
		});
	});

	test("a desk-decided payment cannot gain a verifier afterwards", async ({
		assert,
	}) => {
		const { a, mine, owner } = await twoTenants();

		await withDbContext({ tenantId: a.id }, async (trx) => {
			const id = idOf(
				await insertRow(
					trx,
					"payments",
					newPayment(a.id, mine.id, {
						status: "verified",
						verified_at: new Date(),
					}),
				),
			);

			await assert.rejects(
				() =>
					withTransaction((inner) =>
						updateRow(inner, "payments", id, { verified_by_user_id: owner.id }),
					),
				/payments_guard: verified_by_user_id cannot change/,
			);
		});
	});

	// Clearing the verifier by hand is refused while the account exists: only
	// the account's deletion (ON DELETE SET NULL) may do it.
	for (const status of ["verified", "rejected"] as const) {
		test(`the verifier of a ${status} payment cannot be cleared by hand while the account exists`, async ({
			assert,
		}) => {
			const { a, mine, owner } = await twoTenants();

			await withDbContext({ tenantId: a.id }, async (trx) => {
				const id = idOf(
					await insertRow(
						trx,
						"payments",
						newPayment(a.id, mine.id, verified(owner.id, { status })),
					),
				);

				await assert.rejects(
					() =>
						withTransaction((inner) =>
							updateRow(inner, "payments", id, { verified_by_user_id: null }),
						),
					/payments_guard: verified_by_user_id cannot change/,
				);
			});
		});
	}

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

	test("deleting a user who decided payments in two studios clears the verifier on all of them", async ({
		assert,
	}) => {
		const { a, b, mine, theirs } = await twoTenants();
		const verifier = await User.create({
			email: "verifier@example.com",
			password: "secret-password",
		});

		const accepted = await withDbContext({ tenantId: a.id }, async (trx) =>
			idOf(
				await insertRow(
					trx,
					"payments",
					newPayment(a.id, mine.id, verified(verifier.id)),
				),
			),
		);
		const turnedDown = await withDbContext({ tenantId: a.id }, async (trx) =>
			idOf(
				await insertRow(
					trx,
					"payments",
					newPayment(
						a.id,
						mine.id,
						verified(verifier.id, { status: "rejected" }),
					),
				),
			),
		);
		const elsewhere = await withDbContext({ tenantId: b.id }, async (trx) =>
			idOf(
				await insertRow(
					trx,
					"payments",
					newPayment(b.id, theirs.id, verified(verifier.id)),
				),
			),
		);

		await withDbContext({ tenantId: a.id }, (trx) =>
			trx.rawQuery("delete from users where id = ?", [verifier.id]),
		);

		const decided = async (
			tenant: { id: string },
			id: string,
			status: string,
		) =>
			withDbContext({ tenantId: tenant.id }, async (trx) => {
				const { rows } = await trx.rawQuery(
					"select status, verified_at, verified_by_user_id from payments where id = ?",
					[id],
				);
				assert.equal(rows[0].status, status);
				assert.isNotNull(rows[0].verified_at);
				assert.isNull(rows[0].verified_by_user_id);
			});
		await decided(a, accepted, "verified");
		await decided(a, turnedDown, "rejected");
		await decided(b, elsewhere, "verified");
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

	test("a correction names a payment of its own project, once, and only a correction does", async ({
		assert,
	}) => {
		const { a, b, mine, other, theirs } = await twoTenants();
		const theirPayment = await withDbContext({ tenantId: b.id }, async (trx) =>
			idOf(await insertRow(trx, "payments", newPayment(b.id, theirs.id))),
		);
		const correction = (corrects: string | null, over = {}) =>
			newPayment(a.id, mine.id, {
				kind: "correction",
				amount: -300_000,
				corrects_payment_id: corrects,
				...over,
			});
		const rejects = (values: Record<string, unknown>, message: RegExp) =>
			assert.rejects(
				() => withTransaction((inner) => insertRow(inner, "payments", values)),
				message,
			);

		await withDbContext({ tenantId: a.id }, async (trx) => {
			const deposit = idOf(
				await insertRow(trx, "payments", newPayment(a.id, mine.id)),
			);
			const elsewhere = idOf(
				await insertRow(trx, "payments", newPayment(a.id, other.id)),
			);

			await rejects(correction(null), /payments_correction_target/);
			await rejects(
				newPayment(a.id, mine.id, { corrects_payment_id: deposit }),
				/payments_correction_target/,
			);
			await rejects(correction(elsewhere), /payments_corrects_payment_foreign/);
			await rejects(
				correction(theirPayment),
				/payments_corrects_payment_foreign/,
			);
			const self = randomUUID();
			await rejects(
				correction(self, { id: self }),
				/payments_correction_not_itself/,
			);

			const first = idOf(await insertRow(trx, "payments", correction(deposit)));
			await rejects(correction(deposit), /payments_corrects_payment_id_unique/);
			await assert.rejects(
				() =>
					withTransaction((inner) =>
						updateRow(inner, "payments", first, {
							corrects_payment_id: elsewhere,
						}),
					),
				/payments_guard: corrects_payment_id cannot change/,
			);
		});
	});

	test("the corrections migration refuses, with a clear message, to apply or roll back over corrections", async ({
		assert,
	}) => {
		const { a, mine } = await twoTenants();

		await withDbContext({ tenantId: a.id }, async (trx) => {
			// No correction yet: both checks pass silently.
			await trx.rawQuery(REFUSE_APPLY_OVER_CORRECTIONS);
			await trx.rawQuery(REFUSE_ROLLBACK_OVER_CORRECTIONS);

			const deposit = idOf(
				await insertRow(trx, "payments", newPayment(a.id, mine.id)),
			);
			await insertRow(
				trx,
				"payments",
				newPayment(a.id, mine.id, {
					kind: "correction",
					amount: -300_000,
					corrects_payment_id: deposit,
				}),
			);

			await assert.rejects(
				() =>
					withTransaction((inner) =>
						inner.rawQuery(REFUSE_APPLY_OVER_CORRECTIONS),
					),
				/correction rows that name no payment/,
			);
			await assert.rejects(
				() =>
					withTransaction((inner) =>
						inner.rawQuery(REFUSE_ROLLBACK_OVER_CORRECTIONS),
					),
				/rolling back would drop the payments the reversals name/,
			);
		});
	});

	test("a note is written at insert or with the decision, and afterwards only cleared", async ({
		assert,
	}) => {
		const { a, mine, owner } = await twoTenants();
		const rejects = (id: string, set: Record<string, unknown>) =>
			assert.rejects(
				() => withTransaction((inner) => updateRow(inner, "payments", id, set)),
				/payments_guard: note cannot change/,
			);

		await withDbContext({ tenantId: a.id }, async (trx) => {
			// A desk payment: recorded verified, with its note.
			const desk = idOf(
				await insertRow(
					trx,
					"payments",
					newPayment(a.id, mine.id, {
						...verified(owner.id),
						note: "Paid by her brother",
					}),
				),
			);
			await rejects(desk, { note: "Something else" });
			await updateRow(trx, "payments", desk, { note: null });

			// A screenshot: no note until it is decided, then frozen.
			const proof = idOf(
				await insertRow(trx, "payments", newPayment(a.id, mine.id)),
			);
			await rejects(proof, { note: "Before deciding" });
			await updateRow(
				trx,
				"payments",
				proof,
				verified(owner.id, {
					status: "rejected",
					note: "Not on the statement",
				}),
			);
			await rejects(proof, { note: "Changed my mind" });
			await updateRow(trx, "payments", proof, { note: null });

			await assert.rejects(
				() =>
					withTransaction((inner) =>
						insertRow(
							inner,
							"payments",
							newPayment(a.id, mine.id, { note: "x".repeat(501) }),
						),
					),
				/value too long/,
			);
		});
	});

	test("every kind, status and method in the model is accepted by the database", async ({
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const project = await makeProject(tenant, await makeClient(tenant));
			// A correction names the payment it reverses.
			const corrected = await makePayment(tenant, project);
			for (const kind of PAYMENT_KINDS) {
				const negative = kind === "refund" || kind === "correction";
				await makePayment(tenant, project, {
					kind,
					amount: negative ? -100_000 : 100_000,
					...(kind === "correction" ? { correctsPaymentId: corrected.id } : {}),
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
				1 +
					PAYMENT_KINDS.length +
					PAYMENT_STATUSES.length +
					PAYMENT_METHOD_KINDS.length,
			);
		});
	});
});
