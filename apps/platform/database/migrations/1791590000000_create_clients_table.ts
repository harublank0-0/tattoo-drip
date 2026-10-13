import { BaseSchema } from "@adonisjs/lucid/schema";
import {
	disableTenantRls,
	enableTenantRls,
} from "#database/helpers/tenant_rls";

/**
 * The people who contact a studio (TAT-37): one per phone per tenant.
 * `anonymized_at` is for TAT-42, which scrubs a client's personal data.
 */
export default class extends BaseSchema {
	protected tableName = "clients";

	async up() {
		this.schema.createTable(this.tableName, (table) => {
			table.uuid("id").primary().defaultTo(this.raw("uuidv7()"));
			table
				.uuid("tenant_id")
				.notNullable()
				.references("id")
				.inTable("tenants")
				.onDelete("CASCADE");
			table.string("name", 120).notNullable();
			table.string("phone", 16).nullable();
			table.string("email", 254).nullable();
			table.string("notes", 2000).nullable();
			table.timestamp("anonymized_at", { useTz: true }).nullable();

			table.timestamp("created_at", { useTz: true }).notNullable();
			table.timestamp("updated_at", { useTz: true }).nullable();
			table.timestamp("deleted_at", { useTz: true }).nullable();

			table.index(["tenant_id"]);
		});

		// E.164, the shape normalizePhone produces. A null phone passes this check
		// and is policed by the next one.
		this.schema.raw(
			"alter table clients add constraint clients_phone_e164 check (phone ~ '^[+][1-9][0-9]{7,14}$')",
		);
		this.schema.raw(
			"alter table clients add constraint clients_phone_unless_anonymized check (phone is not null or anonymized_at is not null)",
		);
		// One live client per phone per tenant; a deleted client frees its phone.
		this.schema.raw(
			"create unique index clients_tenant_phone_live_unique on clients (tenant_id, phone) where deleted_at is null and phone is not null",
		);
		for (const sql of enableTenantRls(this.tableName)) this.schema.raw(sql);
	}

	async down() {
		for (const sql of disableTenantRls(this.tableName)) this.schema.raw(sql);
		this.schema.dropTable(this.tableName);
	}
}
