import InventoryItem from "#modules/inventory/models/inventory_item";
import InventoryMovement from "#modules/inventory/models/inventory_movement";
import {
	type InventoryUnit,
	MAX_STOCK,
	type MovementKind,
	toStockUnits,
} from "#modules/inventory/stock";
import { withTransaction } from "#services/db_context";

type InventoryFilter = "active" | "low" | "archived";

type ItemInput = {
	name: string;
	sku?: string;
	category?: string;
	reorderThreshold?: string;
};

type MovementInput = {
	requestId: string;
	kind: MovementKind;
	quantity: string;
	note?: string;
};

export class InventoryRuleError extends Error {
	constructor(
		public field: string,
		message: string,
	) {
		super(message);
	}
}

function itemFields(input: ItemInput) {
	const reorderThreshold = input.reorderThreshold
		? toStockUnits(input.reorderThreshold)
		: null;
	if (reorderThreshold !== null && reorderThreshold > MAX_STOCK) {
		throw new InventoryRuleError(
			"reorderThreshold",
			"Use a threshold of 2,000,000 or less.",
		);
	}
	return {
		name: input.name,
		sku: input.sku || null,
		category: input.category || null,
		reorderThreshold,
	};
}

function activeItem(tenantId: string, id: string) {
	return InventoryItem.query().where("tenant_id", tenantId).where("id", id);
}

export default class InventoryService {
	list(
		tenantId: string,
		status: InventoryFilter,
		search: string,
		page: number,
	) {
		const query = (
			status === "archived"
				? InventoryItem.onlyTrashed()
				: InventoryItem.query()
		).where("tenant_id", tenantId);
		if (status === "low") {
			query.whereRaw("quantity <= reorder_threshold");
		}
		if (search) {
			const pattern = `%${search.replaceAll(/[\\%_]/g, "\\$&")}%`;
			query.where((group) =>
				group
					.whereILike("name", pattern)
					.orWhereILike("sku", pattern)
					.orWhereILike("category", pattern),
			);
		}
		return query.orderBy("name").orderBy("id").paginate(page, 30);
	}

	find(tenantId: string, id: string) {
		return InventoryItem.withTrashed()
			.where("tenant_id", tenantId)
			.where("id", id)
			.firstOrFail();
	}

	history(tenantId: string, itemId: string, page: number) {
		return InventoryMovement.query()
			.where("tenant_id", tenantId)
			.where("item_id", itemId)
			.orderBy("created_at", "desc")
			.orderBy("id", "desc")
			.paginate(page, 30);
	}

	create(tenantId: string, input: ItemInput & { unit: InventoryUnit }) {
		return InventoryItem.create({
			tenantId,
			...itemFields(input),
			unit: input.unit,
			quantity: 0,
		});
	}

	async update(tenantId: string, id: string, input: ItemInput) {
		return withTransaction(async () => {
			const item = await activeItem(tenantId, id).forUpdate().firstOrFail();
			return item.merge(itemFields(input)).save();
		});
	}

	async archive(tenantId: string, id: string) {
		await withTransaction(async () => {
			const item = await activeItem(tenantId, id).forUpdate().firstOrFail();
			if (item.quantity !== 0) {
				throw new InventoryRuleError(
					"archive",
					"Record or correct the remaining stock before archiving this item.",
				);
			}
			await item.softDelete();
		});
	}

	async record(
		tenantId: string,
		itemId: string,
		userId: string,
		input: MovementInput,
	) {
		return withTransaction(async () => {
			// Serialize changes to this item's balance, including retries and archival.
			const item = await InventoryItem.withTrashed()
				.where("tenant_id", tenantId)
				.where("id", itemId)
				.forUpdate()
				.firstOrFail();
			const quantity = toStockUnits(input.quantity);
			const note = input.note || null;
			const previous = await InventoryMovement.query()
				.where("tenant_id", tenantId)
				.where("item_id", itemId)
				.where("request_id", input.requestId)
				.first();

			if (previous) {
				const original =
					previous.kind === "count"
						? previous.balanceAfter
						: Math.abs(previous.delta);
				if (
					previous.kind === input.kind &&
					original === quantity &&
					previous.note === note &&
					previous.userId === userId
				) {
					return previous;
				}
				throw new InventoryRuleError(
					"quantity",
					"This request was already used. Reload the page to record another movement.",
				);
			}
			if (item.deletedAt) {
				throw new InventoryRuleError(
					"quantity",
					"This item has been archived.",
				);
			}
			const balance =
				input.kind === "count"
					? quantity
					: item.quantity + (input.kind === "receive" ? quantity : -quantity);
			if (balance < 0) {
				throw new InventoryRuleError(
					"quantity",
					"There is not enough stock for this movement.",
				);
			}
			if (balance > MAX_STOCK || quantity > MAX_STOCK) {
				throw new InventoryRuleError(
					"quantity",
					"Stock and movement quantities must be 2,000,000 or less.",
				);
			}
			const delta = balance - item.quantity;
			if (delta === 0) {
				throw new InventoryRuleError(
					"quantity",
					"Enter a quantity that changes the current stock.",
				);
			}

			const movement = await InventoryMovement.create({
				tenantId,
				itemId,
				userId,
				requestId: input.requestId,
				kind: input.kind,
				delta,
				balanceAfter: balance,
				note,
			});
			await item.merge({ quantity: balance }).save();
			return movement;
		});
	}
}
