import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import Client from "#modules/clients/models/client";
import { withDbContext, withTransaction } from "#services/db_context";
import { makeClient, nextPhone } from "#tests/helpers/pipeline";
import { assertRowLevelSecurity } from "#tests/helpers/rls";
import { insertRow } from "#tests/helpers/sql";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

const PHONE = "+9779812345678";

const newClient = (tenantId: string, over: Record<string, unknown> = {}) => ({
	tenant_id: tenantId,
	name: "Sita",
	phone: PHONE,
	...over,
});

test.group("clients table", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a phone must be in E.164 form", async ({ assert }) => {
		const { tenant } = await studioWithOwner();

		await withDbContext({ tenantId: tenant.id }, async (trx) => {
			for (const phone of ["9812345678", "+0123456789", "+97798", "no phone"]) {
				await assert.rejects(
					() =>
						withTransaction((inner) =>
							insertRow(inner, "clients", newClient(tenant.id, { phone })),
						),
					/clients_phone_e164/,
				);
			}
			await insertRow(trx, "clients", newClient(tenant.id));
		});
	});

	test("a phone is unique among a tenant's live clients and free again after a soft delete", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await withDbContext({ tenantId: tenant.id }, async (trx) => {
			await insertRow(trx, "clients", newClient(tenant.id));
			await assert.rejects(
				() =>
					withTransaction((inner) =>
						insertRow(
							inner,
							"clients",
							newClient(tenant.id, { name: "Other" }),
						),
					),
				/clients_tenant_phone_live_unique/,
			);
			await trx.rawQuery(
				"update clients set deleted_at = now() where phone = ?",
				[PHONE],
			);
			await insertRow(trx, "clients", newClient(tenant.id, { name: "Again" }));
			const { rows } = await trx.rawQuery(
				"select count(*)::int as n from clients where phone = ?",
				[PHONE],
			);
			assert.equal(rows[0].n, 2);
		});
	});

	test("two tenants can have a client with the same phone", async () => {
		const { tenant: a } = await studioWithOwner("studio-a", "Studio A");
		const { tenant: b } = await studioWithOwner("studio-b", "Studio B");

		await withDbContext({ tenantId: a.id }, (trx) =>
			insertRow(trx, "clients", newClient(a.id)),
		);
		await withDbContext({ tenantId: b.id }, (trx) =>
			insertRow(trx, "clients", newClient(b.id)),
		);
	});

	test("a client has a phone unless it is anonymized, and anonymized clients are unlimited", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await withDbContext({ tenantId: tenant.id }, async (trx) => {
			await assert.rejects(
				() =>
					withTransaction((inner) =>
						insertRow(inner, "clients", newClient(tenant.id, { phone: null })),
					),
				/clients_phone_unless_anonymized/,
			);
			const gone = { phone: null, anonymized_at: new Date() };
			await insertRow(trx, "clients", newClient(tenant.id, gone));
			await insertRow(trx, "clients", newClient(tenant.id, gone));
		});
	});

	test("row-level security", async ({ assert }) => {
		await assertRowLevelSecurity(assert, "clients", async (tenant) =>
			newClient(tenant.id, { phone: nextPhone() }),
		);
	});
});

test.group("Client model", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("creates a client, hides it when soft-deleted and brings it back on restore", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const client = await makeClient(tenant, {
				phone: PHONE,
				email: "sita@example.com",
				notes: "Prefers mornings",
			});
			assert.equal(client.tenantId, tenant.id);
			assert.equal(client.phone, PHONE);
			assert.equal(client.email, "sita@example.com");
			assert.equal(client.notes, "Prefers mornings");
			// create() leaves column defaults unset on the instance: read the row back.
			await client.refresh();
			assert.isNull(client.anonymizedAt);

			await client.softDelete();
			assert.isEmpty(await Client.query().where("tenant_id", tenant.id));
			assert.lengthOf(
				await Client.onlyTrashed().where("tenant_id", tenant.id),
				1,
			);

			await client.restore();
			assert.lengthOf(await Client.query().where("tenant_id", tenant.id), 1);
		});
	});

	test("a returning client can be created after the first one is deleted", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const first = await makeClient(tenant, { phone: PHONE });
			await first.softDelete();

			const returning = await makeClient(tenant, { phone: PHONE });

			assert.notEqual(returning.id, first.id);
			assert.equal(returning.phone, PHONE);
		});
	});
});
