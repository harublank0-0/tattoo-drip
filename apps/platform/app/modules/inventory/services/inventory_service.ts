import { randomUUID } from "node:crypto";
import type { TransactionClientContract } from "@adonisjs/lucid/types/database";
import type { ModelQueryBuilderContract } from "@adonisjs/lucid/types/model";
import { DateTime } from "luxon";
import User from "#models/user";
import {
	InventoryCsvError,
	MAX_EXPORT_ROWS,
	type parseInventoryCsv,
} from "#modules/inventory/csv";
import InventoryItem from "#modules/inventory/models/inventory_item";
import InventoryLot from "#modules/inventory/models/inventory_lot";
import InventoryMovement from "#modules/inventory/models/inventory_movement";
import {
	type ExpiryStatus,
	expiryHorizon,
	expiryStatus,
	type InventoryUnit,
	isCalendarDate,
	LOTS_PER_PAGE,
	MAX_LISTED_LOTS,
	MAX_STOCK,
	type MovementKind,
	stockLabel,
	type TrackingMode,
	toStockUnits,
} from "#modules/inventory/stock";
import { withTransaction } from "#services/db_context";

type InventoryFilter = "active" | "low" | "expiring" | "archived";

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
	lotId?: string;
	lotNumber?: string;
	expiresOn?: string;
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

type ItemQuery = ModelQueryBuilderContract<typeof InventoryItem>;

/**
 * Narrows `query` to the items that count as the same item as `name` and
 * `sku`: the same SKU, or the same name where either has no SKU (case
 * ignored). CSV import and the item forms share this one rule.
 */
function sameItem(query: ItemQuery, name: string, sku: string | null) {
	return query.where((match) => {
		if (sku) {
			match
				.whereRaw("lower(sku) = lower(?)", [sku])
				.orWhereRaw("(lower(name) = lower(?) and sku is null)", [name]);
		} else {
			match.whereRaw("lower(name) = lower(?)", [name]);
		}
	});
}

/**
 * Refuses a name and SKU another item already uses: any item, archived ones
 * included (a new item must not shadow one that can be restored), or only
 * active ones (for a restore). Run under the catalog lock.
 */
async function assertDistinct(
	tenantId: string,
	fields: { name: string; sku: string | null },
	options: { exceptId?: string; includeArchived: boolean; field?: string },
) {
	const query = (
		options.includeArchived
			? InventoryItem.withTrashed()
			: InventoryItem.query()
	).where("tenant_id", tenantId);
	if (options.exceptId) query.whereNot("id", options.exceptId);
	const found = await sameItem(query, fields.name, fields.sku).first();
	if (!found) return;
	const bySku =
		fields.sku !== null &&
		found.sku?.toLowerCase() === fields.sku.toLowerCase();
	const what = bySku ? "SKU" : "name";
	throw new InventoryRuleError(
		options.field ?? (bySku ? "sku" : "name"),
		found.deletedAt
			? `An archived item already uses this ${what}: ${found.name}. Restore it from the archived list instead.`
			: `Another item already uses this ${what}: ${found.name}.`,
	);
}

function activeItem(tenantId: string, id: string) {
	return InventoryItem.query().where("tenant_id", tenantId).where("id", id);
}

/** The lots of one item of the studio. */
function lotQuery(tenantId: string, itemId: string) {
	return InventoryLot.query()
		.where("tenant_id", tenantId)
		.where("item_id", itemId);
}

/** Stock of the item held in its lots (all of it once lots are tracked). */
async function lotTotal(tenantId: string, itemId: string) {
	const [row] = await lotQuery(tenantId, itemId)
		.sum("quantity as total")
		.pojo<{ total: string | null }>();
	return Number(row?.total ?? 0);
}

/**
 * The lot a movement names: by id or, with `create` (a receipt or an
 * assignment), by supplier lot number matched without regard to case, where
 * an unknown number becomes a new, empty lot of this item and a known one
 * without a date takes the given expiry. Locked for the rest of the
 * transaction.
 */
async function resolveLot(
	tenantId: string,
	itemId: string,
	input: MovementInput,
	create: boolean,
) {
	if (input.lotId) {
		const lot = await lotQuery(tenantId, itemId)
			.where("id", input.lotId)
			.forUpdate()
			.first();
		if (!lot) {
			throw new InventoryRuleError("lotId", "Choose a lot of this item.");
		}
		return lot;
	}
	// Only a receipt or an assignment names a lot by its supplier number (and
	// may date it); every other movement picks one of the item's lots.
	if (!create) {
		throw new InventoryRuleError("lotId", "Choose a lot.");
	}
	if (!input.lotNumber) {
		throw new InventoryRuleError("lotNumber", "Enter the supplier lot number.");
	}
	if (input.expiresOn && !isCalendarDate(input.expiresOn)) {
		throw new InventoryRuleError("expiresOn", "Enter a valid expiry date.");
	}
	const existing = await lotQuery(tenantId, itemId)
		.whereRaw("lower(lot_number) = lower(?)", [input.lotNumber])
		.forUpdate()
		.first();
	if (existing) {
		const recorded = existing.expiresOn?.toISODate() ?? null;
		if (input.expiresOn && recorded !== input.expiresOn) {
			// A date for a lot recorded without one, or for an empty lot (its old
			// date describes no stock); a lot holding stock keeps its date, which
			// an owner corrects with "Change expiry".
			if (recorded && existing.quantity > 0) {
				throw new InventoryRuleError(
					"expiresOn",
					`Lot ${existing.lotNumber} is recorded with expiry ${recorded}. Check the lot number or the date.`,
				);
			}
			await existing
				.merge({ expiresOn: DateTime.fromISO(input.expiresOn) })
				.save();
		}
		return existing;
	}
	return InventoryLot.create({
		tenantId,
		itemId,
		lotNumber: input.lotNumber,
		expiresOn: input.expiresOn ? DateTime.fromISO(input.expiresOn) : null,
		quantity: 0,
	});
}

/** Whether a stored movement is the one this request already recorded. */
async function sameRequest(
	previous: InventoryMovement,
	input: MovementInput,
	quantity: number,
	note: string | null,
	userId: string,
) {
	const original =
		previous.kind === "count"
			? (previous.lotBalanceAfter ?? previous.balanceAfter)
			: Math.abs(previous.lotDelta ?? previous.delta);
	if (
		previous.kind !== input.kind ||
		original !== quantity ||
		previous.note !== note ||
		previous.userId !== userId
	) {
		return false;
	}
	if (!previous.lotId) return !input.lotId && !input.lotNumber;
	if (input.lotId) return input.lotId === previous.lotId;
	if (!input.lotNumber) return false;
	const lot = await InventoryLot.query()
		.where("tenant_id", previous.tenantId)
		.where("id", previous.lotId)
		.firstOrFail();
	return lot.lotNumber.toLowerCase() === input.lotNumber.toLowerCase();
}

function catalogLock(trx: TransactionClientContract, tenantId: string) {
	return trx.rawQuery("select pg_advisory_xact_lock(hashtextextended(?, 0))", [
		`inventory-catalog:${tenantId}`,
	]);
}

export default class InventoryService {
	list(
		tenantId: string,
		status: InventoryFilter,
		search: string,
		page: number,
		today: string,
	) {
		const query = (
			status === "archived"
				? InventoryItem.onlyTrashed()
				: InventoryItem.query()
		).where("tenant_id", tenantId);
		if (status === "low") {
			query.whereRaw("quantity <= reorder_threshold");
		}
		if (status === "expiring") {
			query.whereRaw(
				"exists (select 1 from inventory_lots l where l.tenant_id = inventory_items.tenant_id and l.item_id = inventory_items.id and l.quantity > 0 and l.expires_on <= ?)",
				[expiryHorizon(today)],
			);
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

	/**
	 * Per item, the worst expiry among its lots that still hold stock:
	 * "expired", "soon" (within EXPIRY_WARNING_DAYS) or absent.
	 */
	async expiryFlags(tenantId: string, itemIds: string[], today: string) {
		const flags = new Map<string, ExpiryStatus>();
		if (itemIds.length === 0) return flags;
		const lots = await InventoryLot.query()
			.where("tenant_id", tenantId)
			.whereIn("item_id", itemIds)
			.where("quantity", ">", 0)
			.where("expires_on", "<=", expiryHorizon(today));
		for (const lot of lots) {
			const status = expiryStatus(lot.expiresOn?.toISODate() ?? null, today);
			if (status === "expired" || !flags.has(lot.itemId)) {
				flags.set(lot.itemId, status);
			}
		}
		return flags;
	}

	/**
	 * The item's lots that hold stock, earliest expiry first (lots without a
	 * date last, then oldest first): the order to use them in.
	 * - `choices`: what the movement forms offer, the first MAX_LISTED_LOTS,
	 *   plus the lot `includeId` names (the one whose history is open) when
	 *   it holds stock further down.
	 * - `listed`: one page of LOTS_PER_PAGE for the Lots list, which pages
	 *   through all of them.
	 * - `assigned`: the stock held in all the item's lots.
	 */
	async lots(tenantId: string, itemId: string, page = 1, includeId?: string) {
		// One after the other: queries share the request's connection.
		const stocked = () =>
			lotQuery(tenantId, itemId)
				.where("quantity", ">", 0)
				.orderByRaw("expires_on asc nulls last")
				.orderBy("created_at")
				.orderBy("id");
		const choices = await stocked().limit(MAX_LISTED_LOTS);
		if (includeId && !choices.some(({ id }) => id === includeId)) {
			const extra = await stocked().where("id", includeId).first();
			if (extra) choices.push(extra);
		}
		const listed = await stocked().paginate(page, LOTS_PER_PAGE);
		const assigned = await lotTotal(tenantId, itemId);
		return { choices, listed, assigned };
	}

	findLot(tenantId: string, itemId: string, id: string) {
		return lotQuery(tenantId, itemId).where("id", id).firstOrFail();
	}

	find(tenantId: string, id: string) {
		return InventoryItem.withTrashed()
			.where("tenant_id", tenantId)
			.where("id", id)
			.firstOrFail();
	}

	async history(
		tenantId: string,
		itemId: string,
		page: number,
		lotId?: string,
	) {
		const query = InventoryMovement.query()
			.where("tenant_id", tenantId)
			.where("item_id", itemId);
		if (lotId) query.where("lot_id", lotId);
		const movements = await query
			.orderBy("created_at", "desc")
			.orderBy("id", "desc")
			.paginate(page, 30);
		const ids = [
			...new Set(
				movements.all().flatMap(({ userId }) => (userId ? [userId] : [])),
			),
		];
		const users =
			ids.length === 0
				? []
				: await User.query()
						.select("id", "full_name", "email")
						.whereIn("id", ids);
		const lotIds = [
			...new Set(
				movements.all().flatMap(({ lotId }) => (lotId ? [lotId] : [])),
			),
		];
		const lots =
			lotIds.length === 0
				? []
				: await InventoryLot.query()
						.select("id", "lot_number")
						.where("tenant_id", tenantId)
						.whereIn("id", lotIds);
		return {
			movements,
			users: new Map(users.map((user) => [user.id, user])),
			lots: new Map(lots.map((lot) => [lot.id, lot.lotNumber])),
		};
	}

	create(tenantId: string, input: ItemInput & { unit: InventoryUnit }) {
		return withTransaction(async (trx) => {
			await catalogLock(trx, tenantId);
			const fields = itemFields(input);
			await assertDistinct(tenantId, fields, { includeArchived: true });
			return InventoryItem.create({
				tenantId,
				...fields,
				unit: input.unit,
				quantity: 0,
			});
		});
	}

	async importCatalog(
		tenantId: string,
		userId: string,
		rows: Awaited<ReturnType<typeof parseInventoryCsv>>,
	) {
		return withTransaction(async (trx) => {
			await catalogLock(trx, tenantId);
			// Check even archived items so a retry cannot revive or duplicate them.
			// Two items are the same when their SKUs match, or when their names
			// match and either has no SKU, whatever the order of the rows.
			const skus = new Set<string>();
			const names = new Set<string>();
			const unskuedNames = new Set<string>();
			for (const row of rows) {
				const sku = row.sku?.toLowerCase();
				const name = row.name.toLowerCase();
				const existing = await sameItem(
					InventoryItem.withTrashed().where("tenant_id", tenantId),
					row.name,
					row.sku || null,
				).first();
				const repeated = sku
					? skus.has(sku) || unskuedNames.has(name)
					: names.has(name);
				if (repeated || existing) {
					throw new InventoryCsvError(
						`An item with this SKU or name already exists: ${row.sku || row.name}.`,
					);
				}
				if (sku) skus.add(sku);
				else unskuedNames.add(name);
				names.add(name);
				const item = await InventoryItem.create({
					tenantId,
					...itemFields(row),
					unit: row.unit,
					quantity: row.quantity,
				});
				if (row.quantity > 0) {
					await InventoryMovement.create({
						tenantId,
						userId,
						itemId: item.id,
						requestId: randomUUID(),
						kind: "receive",
						delta: row.quantity,
						balanceAfter: row.quantity,
						note: "Opening stock from CSV import",
					});
				}
			}
			return rows.length;
		});
	}

	async exportCatalog(tenantId: string) {
		const items = await InventoryItem.query()
			.where("tenant_id", tenantId)
			.orderBy("name")
			.orderBy("id")
			.limit(MAX_EXPORT_ROWS + 1);
		if (items.length > MAX_EXPORT_ROWS) {
			throw new InventoryCsvError(
				`CSV export supports up to ${MAX_EXPORT_ROWS.toLocaleString("en")} active items.`,
			);
		}
		return items;
	}

	async update(tenantId: string, id: string, input: ItemInput) {
		return withTransaction(async (trx) => {
			await catalogLock(trx, tenantId);
			const item = await activeItem(tenantId, id).forUpdate().firstOrFail();
			const fields = itemFields(input);
			await assertDistinct(tenantId, fields, {
				exceptId: item.id,
				includeArchived: true,
			});
			return item.merge(fields).save();
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

	/**
	 * Brings an archived item back, with its stock (zero), lots and history,
	 * unless an active item has taken its name or SKU meanwhile.
	 */
	async restore(tenantId: string, id: string) {
		return withTransaction(async (trx) => {
			await catalogLock(trx, tenantId);
			const item = await InventoryItem.onlyTrashed()
				.where("tenant_id", tenantId)
				.where("id", id)
				.forUpdate()
				.firstOrFail();
			await assertDistinct(tenantId, item, {
				exceptId: item.id,
				includeArchived: false,
				field: "restore",
			});
			await item.restore();
			return item;
		});
	}

	/**
	 * Every lot holding stock of an active item, for the lots CSV: item by
	 * name, then earliest expiry first.
	 */
	async exportLots(tenantId: string) {
		const rows = await InventoryLot.query()
			.select(
				"inventory_lots.*",
				"inventory_items.name as item_name",
				"inventory_items.sku as item_sku",
				"inventory_items.unit as item_unit",
			)
			.join("inventory_items", (join) =>
				join
					.on("inventory_items.id", "inventory_lots.item_id")
					.andOn("inventory_items.tenant_id", "inventory_lots.tenant_id"),
			)
			.where("inventory_lots.tenant_id", tenantId)
			.whereNull("inventory_items.deleted_at")
			.where("inventory_lots.quantity", ">", 0)
			.orderBy("inventory_items.name")
			.orderBy("inventory_items.id")
			.orderByRaw("inventory_lots.expires_on asc nulls last")
			.orderBy("inventory_lots.id")
			.limit(MAX_EXPORT_ROWS + 1);
		if (rows.length > MAX_EXPORT_ROWS) {
			throw new InventoryCsvError(
				`CSV export supports up to ${MAX_EXPORT_ROWS.toLocaleString("en")} lots.`,
			);
		}
		return rows.map((lot) => ({
			itemName: lot.$extras.item_name as string,
			sku: lot.$extras.item_sku as string | null,
			unit: lot.$extras.item_unit as string,
			lotNumber: lot.lotNumber,
			expiresOn: lot.expiresOn?.toISODate() ?? null,
			quantity: lot.quantity,
		}));
	}

	async record(
		tenantId: string,
		itemId: string,
		userId: string,
		input: MovementInput,
	) {
		return withTransaction(async () => {
			// Serialize changes to this item's balance and its lots, including
			// retries, archival and changes to the tracking mode.
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
				if (await sameRequest(previous, input, quantity, note, userId)) {
					// A retry: nothing new is recorded, and the caller can say so.
					previous.$extras.replayed = true;
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
			if (quantity > MAX_STOCK) {
				throw new InventoryRuleError(
					"quantity",
					"Stock and movement quantities must be 2,000,000 or less.",
				);
			}
			const movement = {
				tenantId,
				itemId,
				userId,
				requestId: input.requestId,
				kind: input.kind,
				note,
			};

			if (input.kind === "assign") {
				if (item.tracking === "lot") {
					throw new InventoryRuleError(
						"kind",
						"This item already tracks lots. Receive stock into a lot instead.",
					);
				}
				const lot = await resolveLot(tenantId, itemId, input, true);
				const unassigned = item.quantity - (await lotTotal(tenantId, itemId));
				if (quantity === 0 || quantity > unassigned) {
					throw new InventoryRuleError(
						"quantity",
						`Enter up to ${stockLabel(unassigned, item.unit)}: the stock not yet in a lot.`,
					);
				}
				const lotBalance = lot.quantity + quantity;
				const created = await InventoryMovement.create({
					...movement,
					delta: 0,
					balanceAfter: item.quantity,
					lotId: lot.id,
					lotDelta: quantity,
					lotBalanceAfter: lotBalance,
				});
				await lot.merge({ quantity: lotBalance }).save();
				return created;
			}

			if (input.kind === "release") {
				if (item.tracking === "lot") {
					throw new InventoryRuleError(
						"kind",
						"This item tracks lots. Correct a lot's balance with a count instead.",
					);
				}
				if (!input.lotId) {
					throw new InventoryRuleError("lotId", "Choose a lot.");
				}
				const lot = await resolveLot(tenantId, itemId, input, false);
				if (quantity === 0 || quantity > lot.quantity) {
					throw new InventoryRuleError(
						"quantity",
						`Enter up to ${stockLabel(lot.quantity, item.unit)}: what lot ${lot.lotNumber} holds.`,
					);
				}
				const lotBalance = lot.quantity - quantity;
				const created = await InventoryMovement.create({
					...movement,
					delta: 0,
					balanceAfter: item.quantity,
					lotId: lot.id,
					lotDelta: -quantity,
					lotBalanceAfter: lotBalance,
				});
				await lot.merge({ quantity: lotBalance }).save();
				return created;
			}

			if (item.tracking === "standard") {
				if (input.lotId || input.lotNumber) {
					throw new InventoryRuleError(
						"lotId",
						"This item doesn't track lots.",
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
				if (balance > MAX_STOCK) {
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
				if (delta < 0) {
					// Stock already assigned to lots waits for lot tracking.
					const assigned = await lotTotal(tenantId, itemId);
					if (balance < assigned) {
						throw new InventoryRuleError(
							"quantity",
							`Only ${stockLabel(item.quantity - assigned, item.unit)} is outside lots. The rest is waiting for lot tracking to be turned on.`,
						);
					}
				}
				const created = await InventoryMovement.create({
					...movement,
					delta,
					balanceAfter: balance,
				});
				await item.merge({ quantity: balance }).save();
				return created;
			}

			const lot = await resolveLot(
				tenantId,
				itemId,
				input,
				input.kind === "receive",
			);
			const lotBalance =
				input.kind === "count"
					? quantity
					: lot.quantity + (input.kind === "receive" ? quantity : -quantity);
			if (lotBalance < 0) {
				throw new InventoryRuleError(
					"quantity",
					`Lot ${lot.lotNumber} has only ${stockLabel(lot.quantity, item.unit)} left.`,
				);
			}
			const delta = lotBalance - lot.quantity;
			const balance = item.quantity + delta;
			if (balance > MAX_STOCK) {
				throw new InventoryRuleError(
					"quantity",
					"Stock and movement quantities must be 2,000,000 or less.",
				);
			}
			if (delta === 0) {
				throw new InventoryRuleError(
					"quantity",
					"Enter a quantity that changes the lot's stock.",
				);
			}
			const created = await InventoryMovement.create({
				...movement,
				delta,
				balanceAfter: balance,
				lotId: lot.id,
				lotDelta: delta,
				lotBalanceAfter: lotBalance,
			});
			await lot.merge({ quantity: lotBalance }).save();
			await item.merge({ quantity: balance }).save();
			return created;
		});
	}

	/**
	 * Corrects or clears a lot's expiry date (owners). Not a stock movement:
	 * no balance changes.
	 */
	async setLotExpiry(
		tenantId: string,
		itemId: string,
		lotId: string,
		expiresOn: string | null,
	) {
		return withTransaction(async () => {
			await activeItem(tenantId, itemId).forUpdate().firstOrFail();
			const lot = await lotQuery(tenantId, itemId)
				.where("id", lotId)
				.forUpdate()
				.first();
			if (!lot) {
				throw new InventoryRuleError("lotId", "Choose a lot of this item.");
			}
			if (expiresOn && !isCalendarDate(expiresOn)) {
				throw new InventoryRuleError("expiresOn", "Enter a valid expiry date.");
			}
			return lot
				.merge({ expiresOn: expiresOn ? DateTime.fromISO(expiresOn) : null })
				.save();
		});
	}

	/**
	 * Turns lot tracking on once every unit on hand is in a lot, or off once
	 * no lot holds stock, so the lots always add up to a tracked item.
	 */
	async setTracking(tenantId: string, id: string, tracking: TrackingMode) {
		return withTransaction(async () => {
			const item = await activeItem(tenantId, id).forUpdate().firstOrFail();
			if (item.tracking === tracking) return item;
			const assigned = await lotTotal(tenantId, id);
			if (tracking === "lot" && assigned !== item.quantity) {
				throw new InventoryRuleError(
					"tracking",
					`Assign the remaining ${stockLabel(item.quantity - assigned, item.unit)} to lots before turning on lot tracking.`,
				);
			}
			if (tracking === "standard" && assigned !== 0) {
				throw new InventoryRuleError(
					"tracking",
					"Lot tracking can be turned off once every lot is used up or counted to zero.",
				);
			}
			return item.merge({ tracking }).save();
		});
	}
}
