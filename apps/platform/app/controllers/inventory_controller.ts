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
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime.
import InventoryService, {
	InventoryRuleError,
} from "#modules/inventory/services/inventory_service";
import { INVENTORY_UNITS } from "#modules/inventory/stock";
import {
	createInventoryItemValidator,
	inventoryMovementValidator,
	updateInventoryItemValidator,
} from "#modules/inventory/validators/inventory";

const pageNumber = (value: unknown) =>
	typeof value === "string" && /^[1-9]\d{0,7}$/.test(value) ? Number(value) : 1;

function itemView(item: InventoryItem) {
	return {
		id: item.id,
		name: item.name,
		sku: item.sku,
		category: item.category,
		unit: item.unit,
		quantity: item.quantity,
		reorderThreshold: item.reorderThreshold,
		archived: Boolean(item.deletedAt),
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
			query.status === "low" || query.status === "archived"
				? query.status
				: "active";
		const search =
			typeof query.q === "string" ? query.q.trim().slice(0, 120) : "";
		const items = await this.inventory.list(
			tenant.id,
			status,
			search,
			pageNumber(query.page),
		);
		return ctx.inertia.render("inventory/index", {
			items: items.all().map(itemView),
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
		const { movements, users } = await this.inventory.history(
			tenant.id,
			item.id,
			pageNumber(ctx.request.qs().page),
		);
		return ctx.inertia.render("inventory/show", {
			item: itemView(item),
			canManage,
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
		await asFieldErrors(() =>
			this.inventory.record(
				tenant.id,
				item.id,
				ctx.auth.getUserOrFail().id,
				input,
			),
		);
		ctx.session.flash("success", "Stock movement recorded.");
		return ctx.response
			.redirect()
			.toRoute("tenant.inventory.show", { tenant: tenant.slug, id: item.id });
	}

	async exportCsv(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		try {
			const items = await this.inventory.exportCatalog(tenant.id);
			ctx.response.header("Cache-Control", "no-store");
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
