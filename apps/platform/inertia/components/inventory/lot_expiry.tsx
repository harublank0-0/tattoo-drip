import { Form } from "@adonisjs/inertia/react";
import { Button } from "~/components/ui/button";
import { Field, FieldError, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import type { InventoryLot } from "./lots";

/**
 * Owners: correct or clear a lot's expiry date, folded under the lot's row
 * so the list stays short on a phone. No stock changes.
 */
export function LotExpiryForm({
	lot,
	params,
}: {
	lot: InventoryLot;
	params: { tenant: string; id: string };
}) {
	const inputId = `lot-expiry-${lot.id}`;
	return (
		<details className="basis-full">
			<summary className="inline-flex min-h-11 cursor-pointer items-center underline underline-offset-4">
				Change expiry
			</summary>
			<Form
				// A fresh form once the saved date comes back.
				key={lot.expiresOn ?? "none"}
				route="tenant.inventory.lots.expiry"
				routeParams={params}
				options={{ preserveScroll: true }}
				className="flex flex-wrap items-end gap-2 pt-2"
			>
				{({ errors, processing }) => (
					<>
						<input type="hidden" name="lotId" value={lot.id} />
						<Field data-invalid={!!errors.expiresOn} className="min-w-0 flex-1">
							<FieldLabel htmlFor={inputId}>
								Expiry date of lot {lot.number} (empty for none)
							</FieldLabel>
							<Input
								id={inputId}
								name="expiresOn"
								type="date"
								min="2000-01-01"
								max="2100-12-31"
								defaultValue={lot.expiresOn ?? ""}
								aria-invalid={!!errors.expiresOn}
							/>
							{errors.expiresOn && <FieldError>{errors.expiresOn}</FieldError>}
							{errors.lotId && <FieldError>{errors.lotId}</FieldError>}
						</Field>
						<Button type="submit" variant="outline" disabled={processing}>
							{processing ? "Saving…" : "Save expiry"}
						</Button>
					</>
				)}
			</Form>
		</details>
	);
}
