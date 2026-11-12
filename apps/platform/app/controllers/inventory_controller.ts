import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { errors } from "@vinejs/vine";
import { tenantContext } from "#middleware/tenant_middleware";
import {
	InventoryCsvError,
	inventoryCsv,
	parseInventoryCsv,
} from "#modules/inventory/csv";
import type InventoryItem from "#modules/inventory/models/inventory_item";
import type InventoryLot from "#modules/inventory/models/inventory_lot";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime.
import InventoryService, {
	InventoryRuleError,
} from "#modules/inventory/services/inventory_service";
import {
	EXPIRY_WARNING_DAYS,
	type ExpiryStatus,
	expiryStatus,
	INVENTORY_UNITS,
} from "#modules/inventory/stock";
import {
	createInventoryItemValidator,
	inventoryMovementValidator,
	inventoryTrackingValidator,
	lotExpiryValidator,
	updateInventoryItemValidator,
} from "#modules/inventory/validators/inventory";
import { formatDay, todayIn } from "#modules/projects/quotes";

const pageNumber = (value: unknown) =>
	typeof value === "string" && /^[1-9]\d{0,7}$/.test(value) ? Number(value) : 1;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function lotView(lot: InventoryLot, today: string) {
	const expiresOn = lot.expiresOn?.toISODate() ?? null;
	return {
		id: lot.id,
		number: lot.lotNumber,
		quantity: lot.quantity,
		expiresOn,
		expiresLabel: expiresOn ? formatDay(expiresOn) : null,
		expiry: expiryStatus(expiresOn, today),
	};
}

function itemView(item: InventoryItem, expiry: ExpiryStatus = null) {
	return {
		id: item.id,
		name: item.name,
		sku: item.sku,
		category: item.category,
		unit: item.unit,
		quantity: item.quantity,
		reorderThreshold: item.reorderThreshold,
		tracking: item.tracking,
		archived: Boolean(item.deletedAt),
		expiry,
	};
}

async function asFieldErrors<T>(work: () => Promise<T>) {
	try {
		return await work();
	} catch (error) {
		if (!(error instanceof InventoryRuleError)) throw error;
		throw new errors.E_VALIDATION_ERROR([
			{ field: error.field, message: error.message, rule: "inventory" },
		]);
	}
}

@inject()
export default class InventoryController {
	constructor(private inventory: InventoryService) {}

	async index(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const canManage = membership.role === "owner";
		if (!canManage && !membership.inventoryAccess)
			return ctx.response.notFound();
		const query = ctx.request.qs();
		const status =
			query.status === "low" ||
			query.status === "expiring" ||
			query.status === "archived"
				? query.status
				: "active";
		const search =
			typeof query.q === "string" ? query.q.trim().slice(0, 120) : "";
		const today = todayIn(tenant.timezone);
		const items = await this.inventory.list(
			tenant.id,
			status,
			search,
			pageNumber(query.page),
			today,
		);
		const flags = await this.inventory.expiryFlags(
			tenant.id,
			items.all().flatMap((item) => (item.deletedAt ? [] : [item.id])),
			today,
		);
		return ctx.inertia.render("inventory/index", {
			items: items.all().map((item) => itemView(item, flags.get(item.id))),
			expiryWindowDays: EXPIRY_WARNING_DAYS,
			status,
			search,
			page: items.currentPage,
			lastPage: items.lastPage,
			units: [...INVENTORY_UNITS],
			canManage,
		});
	}

	async show(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const canManage = membership.role === "owner";
		if (!canManage && !membership.inventoryAccess)
			return ctx.response.notFound();
		const item = await this.inventory.find(tenant.id, ctx.params.id);
		const query = ctx.request.qs();
		const today = todayIn(tenant.timezone);
		const filter =
			typeof query.lot === "string" && UUID.test(query.lot)
				? await this.inventory.findLot(tenant.id, item.id, query.lot)
				: null;
		const {
			movements,
			users,
			lots: lotNumbers,
		} = await this.inventory.history(
			tenant.id,
			item.id,
			pageNumber(query.page),
			filter?.id,
		);
		const { lots, assigned, stocked } = await this.inventory.lots(
			tenant.id,
			item.id,
		);
		const lotRows = lots.map((lot) => lotView(lot, today));
		const worst = lotRows.some((lot) => lot.expiry === "expired")
			? "expired"
			: lotRows.some((lot) => lot.expiry === "soon")
				? "soon"
				: null;
		return ctx.inertia.render("inventory/show", {
			item: itemView(item, item.deletedAt ? null : worst),
			canManage,
			lots: lotRows,
			// First in, first out by expiry: the earliest lot still in date.
			suggestedLotId:
				lotRows.find((lot) => lot.expiry !== "expired")?.id ?? null,
			unassigned: item.quantity - assigned,
			// Lots with stock, of which `lots` lists the first MAX_LISTED_LOTS.
			lotsWithStock: stocked,
			expiryWindowDays: EXPIRY_WARNING_DAYS,
			lotFilter: filter ? { id: filter.id, number: filter.lotNumber } : null,
			history: movements.all().map((movement) => {
				const user = movement.userId ? users.get(movement.userId) : undefined;
				const actor =
					movement.userId === membership.userId
						? "You"
						: user?.fullName ||
							(canManage ? user?.email : undefined) ||
							(user ? "Studio member" : "Former member");
				return {
					actor,
					id: movement.id,
					kind: movement.kind,
					delta: movement.delta,
					balanceAfter: movement.balanceAfter,
					lot: movement.lotId
						? {
								id: movement.lotId,
								number: lotNumbers.get(movement.lotId) ?? "",
								delta: movement.lotDelta ?? 0,
								balanceAfter: movement.lotBalanceAfter ?? 0,
							}
						: null,
					note: movement.note,
					date: movement.createdAt
						.setZone(tenant.timezone)
						.toFormat("d LLL yyyy, HH:mm"),
				};
			}),
			page: movements.currentPage,
			lastPage: movements.lastPage,
			requestId: randomUUID(),
		});
	}

	async store(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const input = await ctx.request.validateUsing(createInventoryItemValidator);
		const item = await asFieldErrors(() =>
			this.inventory.create(tenant.id, input),
		);
		ctx.session.flash("success", "Inventory item added.");
		return ctx.response
			.redirect()
			.toRoute("tenant.inventory.show", { tenant: tenant.slug, id: item.id });
	}

	async update(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const item = await this.inventory.find(tenant.id, ctx.params.id);
		const input = await ctx.request.validateUsing(updateInventoryItemValidator);
		await asFieldErrors(() => this.inventory.update(tenant.id, item.id, input));
		ctx.session.flash("success", "Inventory item saved.");
		return ctx.response
			.redirect()
			.toRoute("tenant.inventory.show", { tenant: tenant.slug, id: item.id });
	}

	async movement(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const canManage = membership.role === "owner";
		if (!canManage && !membership.inventoryAccess)
			return ctx.response.notFound();
		const item = await this.inventory.find(tenant.id, ctx.params.id);
		const input = await ctx.request.validateUsing(inventoryMovementValidator);
		if (!canManage && input.kind !== "use") return ctx.response.notFound();
		const movement = await asFieldErrors(() =>
			this.inventory.record(
				tenant.id,
				item.id,
				ctx.auth.getUserOrFail().id,
				input,
			),
		);
		ctx.session.flash(
			"success",
			movement.$extras.replayed
				? "This movement was already recorded. Nothing new was added."
				: "Stock movement recorded.",
		);
		return ctx.response
			.redirect()
			.toRoute("tenant.inventory.show", { tenant: tenant.slug, id: item.id });
	}

	async tracking(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const item = await this.inventory.find(tenant.id, ctx.params.id);
		const { tracking } = await ctx.request.validateUsing(
			inventoryTrackingValidator,
		);
		await asFieldErrors(() =>
			this.inventory.setTracking(tenant.id, item.id, tracking),
		);
		ctx.session.flash(
			"success",
			tracking === "lot" ? "Lot tracking is on." : "Lot tracking is off.",
		);
		return ctx.response
			.redirect()
			.toRoute("tenant.inventory.show", { tenant: tenant.slug, id: item.id });
	}

	async lotExpiry(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const item = await this.inventory.find(tenant.id, ctx.params.id);
		const { lotId, expiresOn } =
			await ctx.request.validateUsing(lotExpiryValidator);
		await asFieldErrors(() =>
			this.inventory.setLotExpiry(tenant.id, item.id, lotId, expiresOn ?? null),
		);
		ctx.session.flash("success", "Lot expiry saved.");
		return ctx.response
			.redirect()
			.toRoute("tenant.inventory.show", { tenant: tenant.slug, id: item.id });
	}

	async exportCsv(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		try {
			const items = await this.inventory.exportCatalog(tenant.id);
			ctx.response.header("Cache-Control", "private, no-store");
			ctx.response.header(
				"Content-Disposition",
				'attachment; filename="inventory.csv"',
			);
			return ctx.response.type("text/csv", "utf-8").send(inventoryCsv(items));
		} catch (error) {
			if (!(error instanceof InventoryCsvError)) throw error;
			return ctx.response.badRequest(error.message);
		}
	}

	async importCsv(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const file = ctx.request.file("csv", { size: "512kb", extnames: ["csv"] });
		try {
			if (!file?.isValid || !file.tmpPath) {
				throw new InventoryCsvError("Choose a CSV file up to 512 KB.");
			}
			const rows = await parseInventoryCsv(await readFile(file.tmpPath));
			const count = await this.inventory.importCatalog(
				tenant.id,
				ctx.auth.getUserOrFail().id,
				rows,
			);
			ctx.session.flash(
				"success",
				`Imported ${count} inventory ${count === 1 ? "item" : "items"}.`,
			);
		} catch (error) {
			if (!(error instanceof InventoryCsvError)) throw error;
			ctx.session.flash("error", error.message);
		}
		return ctx.response
			.redirect()
			.toRoute("tenant.inventory.index", { tenant: tenant.slug });
	}

	async archive(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		try {
			await this.inventory.archive(tenant.id, ctx.params.id);
		} catch (error) {
			if (!(error instanceof InventoryRuleError)) throw error;
			ctx.session.flash("error", error.message);
			return ctx.response.redirect().toRoute("tenant.inventory.show", {
				tenant: tenant.slug,
				id: ctx.params.id,
			});
		}
		ctx.session.flash("success", "Inventory item archived.");
		return ctx.response
			.redirect()
			.toRoute("tenant.inventory.index", { tenant: tenant.slug });
	}
}
