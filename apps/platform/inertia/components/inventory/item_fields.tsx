import { Button } from "~/components/ui/button";
import {
	Field,
	FieldError,
	FieldGroup,
	FieldLabel,
} from "~/components/ui/field";
import { Input } from "~/components/ui/input";

export type InventoryItem = {
	id: string;
	name: string;
	sku: string | null;
	category: string | null;
	unit: string;
	quantity: number;
	reorderThreshold: number | null;
	archived: boolean;
};

export const unitNames: Record<string, string> = {
	piece: "Pieces",
	box: "Boxes",
	roll: "Rolls",
	ml: "Millilitres",
	g: "Grams",
};

export function stockAmount(amount: number) {
	return (amount / 1000).toString();
}

export function ItemFields({
	item,
	units,
	errors,
	processing,
}: {
	item?: InventoryItem;
	units?: string[];
	errors: Partial<Record<string, string>>;
	processing: boolean;
}) {
	return (
		<FieldGroup>
			<Field>
				<FieldLabel htmlFor="inventory-name">Item name</FieldLabel>
				<Input
					id="inventory-name"
					name="name"
					required
					maxLength={120}
					defaultValue={item?.name}
					placeholder="Black lining ink"
					aria-invalid={!!errors.name}
				/>
				{errors.name && <FieldError>{errors.name}</FieldError>}
			</Field>
			<div className="grid gap-4 sm:grid-cols-2">
				<Field>
					<FieldLabel htmlFor="inventory-sku">SKU (optional)</FieldLabel>
					<Input
						id="inventory-sku"
						name="sku"
						maxLength={48}
						defaultValue={item?.sku ?? ""}
						aria-invalid={!!errors.sku}
					/>
					{errors.sku && <FieldError>{errors.sku}</FieldError>}
				</Field>
				<Field>
					<FieldLabel htmlFor="inventory-category">
						Category (optional)
					</FieldLabel>
					<Input
						id="inventory-category"
						name="category"
						maxLength={80}
						defaultValue={item?.category ?? ""}
						placeholder="Ink, needles, aftercare"
						aria-invalid={!!errors.category}
					/>
					{errors.category && <FieldError>{errors.category}</FieldError>}
				</Field>
			</div>
			<div className="grid gap-4 sm:grid-cols-2">
				{units && (
					<Field>
						<FieldLabel htmlFor="inventory-unit">Stock unit</FieldLabel>
						<select
							id="inventory-unit"
							name="unit"
							className="min-h-11 rounded-md border bg-background px-3 text-sm"
							aria-invalid={!!errors.unit}
						>
							{units.map((unit) => (
								<option key={unit} value={unit}>
									{unitNames[unit]}
								</option>
							))}
						</select>
						{errors.unit && <FieldError>{errors.unit}</FieldError>}
					</Field>
				)}
				<Field>
					<FieldLabel htmlFor="inventory-threshold">
						Low-stock threshold (optional)
					</FieldLabel>
					<Input
						id="inventory-threshold"
						name="reorderThreshold"
						type="number"
						inputMode="decimal"
						min={0}
						max={2_000_000}
						step="0.001"
						defaultValue={
							item?.reorderThreshold == null
								? ""
								: stockAmount(item.reorderThreshold)
						}
						aria-invalid={!!errors.reorderThreshold}
					/>
					{errors.reorderThreshold && (
						<FieldError>{errors.reorderThreshold}</FieldError>
					)}
				</Field>
			</div>
			<div>
				<Button type="submit" disabled={processing}>
					{item ? "Save item" : "Add item"}
				</Button>
			</div>
		</FieldGroup>
	);
}
