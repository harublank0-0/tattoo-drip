import { BaseSchema } from "@adonisjs/lucid/schema";
import {
	disableTenantRls,
	enableTenantRls,
	tenantReference,
} from "#database/helpers/tenant_rls";

/**
 * Optional lot and expiry tracking per inventory item.
 *
 * - `inventory_items.tracking`: `standard` keeps the single balance; `lot`
 *   means every unit on hand sits in a lot, so the lots add up to the item.
 * - `inventory_lots`: a supplier lot of one item, its optional expiry date
 *   and its balance (thousandths of the item's unit, like the item). Lots
 *   are never deleted: the movements that name them are the history.
 * - Movements may name a lot. The key includes `item_id`, so a movement can
 *   only name a lot of its own item and studio. `lot_delta` and
 *   `lot_balance_after` record the lot's side; `assign` moves stock that was
 *   already on hand into a lot (the item's balance does not change).
 */
export default class extends BaseSchema {
	async up() {
		this.schema.alterTable("inventory_items", (table) => {
			table.string("tracking", 16).notNullable().defaultTo("standard");
		});
		this.schema.raw(
			"alter table inventory_items add constraint inventory_items_tracking check (tracking in ('standard', 'lot'))",
		);

		this.schema.createTable("inventory_lots", (table) => {
			table.uuid("id").primary().defaultTo(this.raw("uuidv7()"));
			table
				.uuid("tenant_id")
				.notNullable()
				.references("id")
				.inTable("tenants")
				.onDelete("CASCADE");
			table.uuid("item_id").notNullable();
			tenantReference(table, "item_id", "inventory_items");
			table.string("lot_number", 64).notNullable();
			table.date("expires_on").nullable();
			table.integer("quantity").notNullable().defaultTo(0);
			table.timestamp("created_at", { useTz: true }).notNullable();
			table.timestamp("updated_at", { useTz: true }).nullable();
			table.index(["tenant_id", "item_id", "expires_on", "id"]);
		});
		for (const sql of enableTenantRls("inventory_lots")) this.schema.raw(sql);
		this.schema.raw(`
			alter table inventory_lots
			add constraint inventory_lots_quantity_range check (quantity between 0 and 2000000000),
			add constraint inventory_lots_number_shape check (lot_number = btrim(lot_number) and lot_number <> ''),
			add constraint inventory_lots_item_lot_unique unique (tenant_id, item_id, id)
		`);
		this.schema.raw(
			"create unique index inventory_lots_number_unique on inventory_lots (tenant_id, item_id, lower(lot_number))",
		);

		this.schema.alterTable("inventory_movements", (table) => {
			table.uuid("lot_id").nullable();
			table.integer("lot_delta").nullable();
			table.integer("lot_balance_after").nullable();
			table.index(["tenant_id", "lot_id", "created_at", "id"]);
		});
		this.schema.raw(`
			alter table inventory_movements
			add constraint inventory_movements_lot_fk foreign key (tenant_id, item_id, lot_id)
				references inventory_lots (tenant_id, item_id, id),
			drop constraint inventory_movements_kind_delta,
			add constraint inventory_movements_kind_delta check (
				(kind = 'receive' and delta > 0)
				or (kind = 'use' and delta < 0)
				or (kind = 'count' and delta <> 0)
				or (kind = 'assign' and delta = 0 and lot_id is not null)
			),
			add constraint inventory_movements_lot_shape check (
				(lot_id is null and lot_delta is null and lot_balance_after is null)
				or (
					lot_id is not null
					and lot_delta is not null
					and lot_balance_after between 0 and 2000000000
					and lot_balance_after::bigint - lot_delta between 0 and 2000000000
					and (case when kind = 'assign' then lot_delta > 0 else lot_delta = delta end)
				)
			)
		`);
	}

	async down() {
		this.schema.raw(`
			alter table inventory_movements
			drop constraint inventory_movements_lot_shape,
			drop constraint inventory_movements_kind_delta,
			drop constraint inventory_movements_lot_fk
		`);
		// Assignments have no meaning without lots; the old check refuses them.
		this.schema.raw("delete from inventory_movements where kind = 'assign'");
		this.schema.raw(`
			alter table inventory_movements
			add constraint inventory_movements_kind_delta check (
				(kind = 'receive' and delta > 0)
				or (kind = 'use' and delta < 0)
				or (kind = 'count' and delta <> 0)
			)
		`);
		this.schema.alterTable("inventory_movements", (table) => {
			table.dropIndex(["tenant_id", "lot_id", "created_at", "id"]);
			table.dropColumn("lot_balance_after");
			table.dropColumn("lot_delta");
			table.dropColumn("lot_id");
		});
		for (const sql of disableTenantRls("inventory_lots")) this.schema.raw(sql);
		this.schema.dropTable("inventory_lots");
		this.schema.raw(
			"alter table inventory_items drop constraint inventory_items_tracking",
		);
		this.schema.alterTable("inventory_items", (table) => {
			table.dropColumn("tracking");
		});
	}
}
