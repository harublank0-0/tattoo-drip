import { InventoryMovementSchema } from "#database/schema";
import type { MovementKind } from "#modules/inventory/stock";

export default class InventoryMovement extends InventoryMovementSchema {
	declare kind: MovementKind;
}
