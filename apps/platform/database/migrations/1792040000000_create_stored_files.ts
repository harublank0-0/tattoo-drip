import { BaseSchema } from "@adonisjs/lucid/schema";
import {
	disableTenantRls,
	enableTenantRls,
} from "#database/helpers/tenant_rls";

/**
 * The storage meter (docs/superpowers/specs/2026-11-16-storage-meter-design.md):
 * one row per counted file with its size, `reserved` while an upload runs
 * (until `expires_at`) and `stored` once it landed. Usage sums the rows a
 * live record still holds (`liveKeysSql`), so a deleted or soft-deleted
 * record's file stops counting at once. Tenant-owned, with row-level
 * security; the key is unique (it names its studio).
 *
 * Also the launch allowances, as new bundle versions (bundles are
 * immutable): Solo 5 GB and Studio 25 GB, each with v1's 40 images.
 */
export default class extends BaseSchema {
	protected tableName = "stored_files";

	async up() {
		this.schema.createTable(this.tableName, (table) => {
			table.uuid("id").primary().defaultTo(this.raw("uuidv7()"));
			table
				.uuid("tenant_id")
				.notNullable()
				.references("id")
				.inTable("tenants")
				.onDelete("CASCADE");
			table.string("key", 512).notNullable().unique();
			table.string("purpose", 64).notNullable();
			table.bigInteger("bytes").notNullable();
			table.string("status", 16).notNullable();
			table.timestamp("reserved_at", { useTz: true }).nullable();
			table.timestamp("expires_at", { useTz: true }).nullable();
			table.timestamp("stored_at", { useTz: true }).nullable();
			table.timestamp("created_at", { useTz: true }).notNullable();
			table.timestamp("updated_at", { useTz: true }).notNullable();
			table.index(["tenant_id", "status"]);
		});
		for (const sql of enableTenantRls(this.tableName)) this.schema.raw(sql);
		for (const statement of [
			"alter table stored_files add constraint stored_files_bytes check (bytes >= 0)",
			"alter table stored_files add constraint stored_files_status check (status in ('reserved', 'stored'))",
			"alter table stored_files add constraint stored_files_status_shape check ((status = 'reserved' and expires_at is not null) or (status = 'stored' and stored_at is not null))",
			"insert into allowance_bundles (key, package, images_per_month, storage_megabytes) values ('solo-v2', 'solo', 40, 5120), ('studio-v2', 'studio', 40, 25600)",
		]) {
			this.schema.raw(statement);
		}
	}

	async down() {
		for (const sql of disableTenantRls(this.tableName)) this.schema.raw(sql);
		this.schema.dropTable(this.tableName);
		// allowance_bundles_guard refuses every DELETE, so it is lifted around
		// this one (the owner runs migrations). A plan or grant that names a v2
		// bundle still stops the rollback (their foreign keys), on purpose.
		for (const statement of [
			"alter table allowance_bundles disable trigger allowance_bundles_guard",
			"delete from allowance_bundles where key in ('solo-v2', 'studio-v2')",
			"alter table allowance_bundles enable trigger allowance_bundles_guard",
		]) {
			this.schema.raw(statement);
		}
	}
}
