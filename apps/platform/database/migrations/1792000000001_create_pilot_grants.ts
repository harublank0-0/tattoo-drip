import { BaseSchema } from "@adonisjs/lucid/schema";
import {
	disableTenantRls,
	enableTenantRls,
} from "#database/helpers/tenant_rls";

/**
 * Pilot grants (docs/superpowers/specs/2026-11-15-studio-packages-design.md,
 * ruling 7): an explicit, temporary package for a pilot studio until its
 * agreed transition date, set by an operator (`node ace packages:pilot`).
 * Tenant-owned, with row-level security. A grant runs `[starts_at,
 * ends_at)`; a new grant ends the running one, so at most one runs.
 */
export default class extends BaseSchema {
	protected tableName = "pilot_grants";

	async up() {
		this.schema.createTable(this.tableName, (table) => {
			table.uuid("id").primary().defaultTo(this.raw("uuidv7()"));
			table
				.uuid("tenant_id")
				.notNullable()
				.references("id")
				.inTable("tenants")
				.onDelete("CASCADE");
			table.string("package", 16).notNullable();
			table
				.uuid("allowance_bundle_id")
				.notNullable()
				.references("id")
				.inTable("allowance_bundles")
				.onDelete("RESTRICT");
			table.timestamp("starts_at", { useTz: true }).notNullable();
			table.timestamp("ends_at", { useTz: true }).notNullable();
			table.string("note", 500).notNullable();
			table.timestamp("created_at", { useTz: true }).notNullable();
			table.index(["tenant_id", "ends_at"]);
			table.index(["allowance_bundle_id"]);
		});
		for (const sql of enableTenantRls(this.tableName)) this.schema.raw(sql);
		for (const statement of [
			"alter table pilot_grants add constraint pilot_grants_package check (package in ('solo', 'studio'))",
			"alter table pilot_grants add constraint pilot_grants_order check (ends_at > starts_at)",
		]) {
			this.schema.raw(statement);
		}
	}

	async down() {
		for (const sql of disableTenantRls(this.tableName)) this.schema.raw(sql);
		this.schema.dropTable(this.tableName);
	}
}
