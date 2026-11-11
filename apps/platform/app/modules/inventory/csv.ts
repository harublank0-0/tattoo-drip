import { parse } from "csv-parse/sync";
import {
	MAX_STOCK,
	QUANTITY_FORMAT,
	toStockUnits,
} from "#modules/inventory/stock";
import { createInventoryItemValidator } from "#modules/inventory/validators/inventory";

const COLUMNS = [
	"name",
	"sku",
	"category",
	"unit",
	"quantity",
	"reorder_threshold",
];
export const MAX_IMPORT_ROWS = 500;
export const MAX_EXPORT_ROWS = 10_000;

export class InventoryCsvError extends Error {}

export async function parseInventoryCsv(bytes: Buffer) {
	let records: string[][];
	try {
		const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
		if (text.includes("\0")) throw new Error("NUL");
		records = parse(text, {
			bom: true,
			skip_empty_lines: true,
			max_record_size: 2048,
		});
	} catch {
		throw new InventoryCsvError(
			"Upload a valid UTF-8 CSV file using the inventory columns.",
		);
	}
	const [header, ...rows] = records;
	if (
		header?.length !== COLUMNS.length ||
		COLUMNS.some((column, index) => header[index] !== column)
	) {
		throw new InventoryCsvError(
			`Use these columns in order: ${COLUMNS.join(", ")}.`,
		);
	}
	if (rows.length === 0 || rows.length > MAX_IMPORT_ROWS) {
		throw new InventoryCsvError(
			`Include 1–${MAX_IMPORT_ROWS} items per import.`,
		);
	}
	return Promise.all(
		rows.map(
			async (
				[name, sku, category, unit, quantity, reorderThreshold],
				index,
			) => {
				try {
					const item = await createInventoryItemValidator.validate({
						name,
						sku: sku.trim() || undefined,
						category: category.trim() || undefined,
						unit: unit.trim(),
						reorderThreshold: reorderThreshold.trim() || undefined,
					});
					const amount = quantity.trim() || "0";
					if (
						!QUANTITY_FORMAT.test(amount) ||
						toStockUnits(amount) > MAX_STOCK ||
						(item.reorderThreshold &&
							toStockUnits(item.reorderThreshold) > MAX_STOCK)
					) {
						throw new Error("quantity");
					}
					return { ...item, quantity: toStockUnits(amount) };
				} catch {
					throw new InventoryCsvError(
						`Item ${index + 1} has invalid fields. Check its name, unit and quantities.`,
					);
				}
			},
		),
	);
}

function textCell(value: string | null) {
	const text = value ?? "";
	// Quoting alone does not prevent spreadsheet applications from evaluating formulas.
	const safe = /^[\t\r\n]|^\s*[=+\-@＝＋－＠]/u.test(text) ? `'${text}` : text;
	return `"${safe.replaceAll('"', '""')}"`;
}

export function inventoryCsv(
	items: readonly {
		name: string;
		sku: string | null;
		category: string | null;
		unit: string;
		quantity: number;
		reorderThreshold: number | null;
	}[],
) {
	const rows = items.map((item) =>
		[
			textCell(item.name),
			textCell(item.sku),
			textCell(item.category),
			item.unit,
			item.quantity / 1000,
			item.reorderThreshold === null ? "" : item.reorderThreshold / 1000,
		].join(","),
	);
	return [COLUMNS.join(","), ...rows, ""].join("\r\n");
}
