export const INVENTORY_UNITS = ["piece", "box", "roll", "ml", "g"] as const;
export const MOVEMENT_KINDS = ["receive", "use", "count"] as const;
export type InventoryUnit = (typeof INVENTORY_UNITS)[number];
export type MovementKind = (typeof MOVEMENT_KINDS)[number];

export const MAX_STOCK = 2_000_000_000;
export const QUANTITY_FORMAT = /^\d{1,7}(?:\.\d{1,3})?$/;

export function toStockUnits(quantity: string) {
	return Math.round(Number(quantity) * 1000);
}
