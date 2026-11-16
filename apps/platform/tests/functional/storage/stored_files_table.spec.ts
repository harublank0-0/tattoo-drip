import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import AllowanceBundle from "#modules/packages/models/allowance_bundle";
import StoredFile from "#modules/storage/models/stored_file";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

/**
 * The storage ledger (docs/superpowers/specs/2026-11-16-storage-meter-design.md):
 * one row per counted file, tenant-owned under row-level security, and the
 * v2 bundles that carry the launch allowances.
 */
test.group("Storage: the stored files table", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	const row = (tenantId: string, over: Record<string, unknown> = {}) => ({
		tenantId,
		key: `tenants/${tenantId}/artist_photo/${crypto.randomUUID()}.jpg`,
		purpose: "artist_photo",
		bytes: 1000,
		status: "stored" as const,
		storedAt: DateTime.utc(),
		...over,
	});

	test("refuses a negative size and a reservation without an expiry", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("ledger-shape", "Ledger Shape");
		// Each attempt in its own context (a savepoint): a refused insert aborts
		// the transaction it runs in.
		await assert.rejects(
			() =>
				inTenant(tenant, () =>
					StoredFile.create(row(tenant.id, { bytes: -1 })),
				),
			/stored_files_bytes/,
		);
		await assert.rejects(
			() =>
				inTenant(tenant, () =>
					StoredFile.create(
						row(tenant.id, {
							status: "reserved",
							storedAt: null,
							reservedAt: DateTime.utc(),
							expiresAt: null,
						}),
					),
				),
			/stored_files_status_shape/,
		);
		// A well-formed row goes in.
		await inTenant(tenant, () => StoredFile.create(row(tenant.id)));
	});

	test("one studio's rows are invisible from another's context", async ({
		assert,
	}) => {
		const { tenant: a } = await studioWithOwner("ledger-a", "Ledger A");
		const { tenant: b } = await studioWithOwner("ledger-b", "Ledger B");
		await inTenant(a, () => StoredFile.create(row(a.id)));

		assert.lengthOf(await inTenant(a, () => StoredFile.all()), 1);
		assert.lengthOf(await inTenant(b, () => StoredFile.all()), 0);
	});

	test("the v2 bundles carry the launch storage allowances", async ({
		assert,
	}) => {
		const solo = await AllowanceBundle.findByOrFail("key", "solo-v2");
		const studio = await AllowanceBundle.findByOrFail("key", "studio-v2");
		assert.equal(solo.storageMegabytes, 5120);
		assert.equal(studio.storageMegabytes, 25600);
	});
});
