import vine from "@vinejs/vine";
import {
	INVENTORY_UNITS,
	MOVEMENT_KINDS,
	QUANTITY_FORMAT,
} from "#modules/inventory/stock";

const itemFields = () => ({
	name: vine.string().trim().minLength(1).maxLength(120),
	sku: vine.string().trim().maxLength(48).optional(),
	category: vine.string().trim().maxLength(80).optional(),
	reorderThreshold: vine.string().trim().regex(QUANTITY_FORMAT).optional(),
});

export const createInventoryItemValidator = vine.create({
	...itemFields(),
	unit: vine.enum(INVENTORY_UNITS),
});

export const updateInventoryItemValidator = vine.create(itemFields());

export const inventoryMovementValidator = vine.create({
	requestId: vine.string().uuid(),
	kind: vine.enum(MOVEMENT_KINDS),
	quantity: vine.string().trim().regex(QUANTITY_FORMAT),
	note: vine.string().trim().maxLength(240).optional(),
});
