import { compose } from "@adonisjs/core/helpers";
import { InventoryItemSchema } from "#database/schema";
import { withSoftDeletes } from "#models/mixins/soft_deletes";
import type { InventoryUnit } from "#modules/inventory/stock";

export default class InventoryItem extends compose(
	InventoryItemSchema,
	withSoftDeletes,
) {
	declare unit: InventoryUnit;
}
