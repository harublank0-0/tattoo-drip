import { BaseSchema } from "@adonisjs/lucid/schema";

/**
 * `release` takes stock back out of a lot while an item is being set up
 * for lot tracking (the undo of `assign`): the item's balance does not
 * change and the lot's goes down.
 */
export default class extends BaseSchema {
	async up() {
		this.schema.raw(`
			alter table inventory_movements
			drop constraint inventory_movements_kind_delta,
			drop constraint inventory_movements_lot_shape,
			add constraint inventory_movements_kind_delta check (
				(kind = 'receive' and delta > 0)
				or (kind = 'use' and delta < 0)
				or (kind = 'count' and delta <> 0)
				or (kind in ('assign', 'release') and delta = 0 and lot_id is not null)
			),
			add constraint inventory_movements_lot_shape check (
				(lot_id is null and lot_delta is null and lot_balance_after is null)
				or (
					lot_id is not null
					and lot_delta is not null
					and lot_balance_after between 0 and 2000000000
					and lot_balance_after::bigint - lot_delta between 0 and 2000000000
					and (
						case kind
							when 'assign' then lot_delta > 0
							when 'release' then lot_delta < 0
							else lot_delta = delta
						end
					)
				)
			)
		`);
	}

	async down() {
		// The old checks refuse releases.
		this.schema.raw("delete from inventory_movements where kind = 'release'");
		this.schema.raw(`
			alter table inventory_movements
			drop constraint inventory_movements_kind_delta,
			drop constraint inventory_movements_lot_shape,
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
}
