import { BaseSchema } from "@adonisjs/lucid/schema";
import { enableTenantRls, tenantReference } from "#database/helpers/tenant_rls";

export default class extends BaseSchema {
	async up() {
		this.schema.createTable("inventory_items", (table) => {
			table.uuid("id").primary().defaultTo(this.raw("uuidv7()"));
			table
				.uuid("tenant_id")
				.notNullable()
				.references("id")
				.inTable("tenants")
				.onDelete("CASCADE");
			table.string("name", 120).notNullable();
			table.string("sku", 48).nullable();
			table.string("category", 80).nullable();
			table.string("unit", 16).notNullable();
			// Stock is stored in thousandths of the selected unit.
			table.integer("quantity").notNullable().defaultTo(0);
			table.integer("reorder_threshold").nullable();
			table.timestamp("created_at", { useTz: true }).notNullable();
			table.timestamp("updated_at", { useTz: true }).nullable();
			table.timestamp("deleted_at", { useTz: true }).nullable();
			table.index(["tenant_id", "deleted_at", "name", "id"]);
		});
		for (const sql of enableTenantRls("inventory_items")) this.schema.raw(sql);
		this.schema.raw(`
			alter table inventory_items
			add constraint inventory_items_quantity_range check (quantity between 0 and 2000000000),
			add constraint inventory_items_threshold_range check (reorder_threshold between 0 and 2000000000),
			add constraint inventory_items_unit check (unit in ('piece', 'box', 'roll', 'ml', 'g'))
		`);

		this.schema.createTable("inventory_movements", (table) => {
			table.uuid("id").primary().defaultTo(this.raw("uuidv7()"));
			table
				.uuid("tenant_id")
				.notNullable()
				.references("id")
				.inTable("tenants")
				.onDelete("CASCADE");
			table.uuid("item_id").notNullable();
			tenantReference(table, "item_id", "inventory_items");
			table
				.uuid("user_id")
				.nullable()
				.references("id")
				.inTable("users")
				.onDelete("SET NULL")
				.index();
			table.uuid("request_id").notNullable();
			table.string("kind", 16).notNullable();
			table.integer("delta").notNullable();
			table.integer("balance_after").notNullable();
			table.string("note", 240).nullable();
			table.timestamp("created_at", { useTz: true }).notNullable();
			table.unique(["tenant_id", "item_id", "request_id"]);
			table.index(["tenant_id", "item_id", "created_at", "id"]);
		});
		for (const sql of enableTenantRls("inventory_movements"))
			this.schema.raw(sql);
		this.schema.raw(`
			alter table inventory_movements
			add constraint inventory_movements_balance_range check (
				balance_after between 0 and 2000000000
				and balance_after::bigint - delta between 0 and 2000000000
			),
			add constraint inventory_movements_kind_delta check (
				(kind = 'receive' and delta > 0)
				or (kind = 'use' and delta < 0)
				or (kind = 'count' and delta <> 0)
			)
		`);
	}

	async down() {
		this.schema.dropTable("inventory_movements");
		this.schema.dropTable("inventory_items");
	}
}
