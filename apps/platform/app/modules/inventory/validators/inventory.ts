import vine, { SimpleMessagesProvider } from "@vinejs/vine";
import {
	DATE_FORMAT,
	INVENTORY_UNITS,
	MOVEMENT_KINDS,
	QUANTITY_FORMAT,
	QUANTITY_MESSAGE,
	TRACKING_MODES,
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

/**
 * A stock movement. A lot-tracked item names its lot by `lotId`, or, when
 * receiving or assigning, by a supplier `lotNumber` (an existing lot of the
 * item with that number, or a new one) and an optional `expiresOn`.
 */
export const inventoryMovementValidator = vine.create({
	requestId: vine.string().uuid(),
	kind: vine.enum(MOVEMENT_KINDS),
	quantity: vine.string().trim().regex(QUANTITY_FORMAT),
	note: vine.string().trim().maxLength(240).optional(),
	lotId: vine.string().uuid().optional(),
	lotNumber: vine.string().trim().minLength(1).maxLength(64).optional(),
	expiresOn: vine.string().trim().regex(DATE_FORMAT).optional(),
});

export const inventoryTrackingValidator = vine.create({
	tracking: vine.enum(TRACKING_MODES),
});

/** Corrects or clears (empty) the expiry date of one of the item's lots. */
export const lotExpiryValidator = vine.create({
	lotId: vine.string().uuid(),
	expiresOn: vine.string().trim().regex(DATE_FORMAT).optional(),
});

const messages = new SimpleMessagesProvider({
	"quantity.regex": QUANTITY_MESSAGE,
	"reorderThreshold.regex": QUANTITY_MESSAGE,
	"expiresOn.regex": "Enter a valid expiry date.",
});
for (const validator of [
	createInventoryItemValidator,
	updateInventoryItemValidator,
	inventoryMovementValidator,
	lotExpiryValidator,
]) {
	validator.messagesProvider = messages;
}
