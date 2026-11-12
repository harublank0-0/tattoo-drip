import { Form } from "@adonisjs/inertia/react";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
} from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import type { InventoryItem } from "./item_fields";
import type { InventoryLot } from "./lots";

const amount = (thousandths: number) => (thousandths / 1000).toString();

function TrackingButton({
	params,
	tracking,
	disabled,
	children,
}: {
	params: { tenant: string; id: string };
	tracking: "standard" | "lot";
	disabled: boolean;
	children: string;
}) {
	return (
		<Form route="tenant.inventory.tracking" routeParams={params}>
			{({ errors, processing }) => (
				<div className="flex flex-col gap-2">
					<input type="hidden" name="tracking" value={tracking} />
					<div>
						<Button
							type="submit"
							variant={tracking === "lot" ? "default" : "outline"}
							className="w-full sm:w-auto"
							disabled={processing || disabled}
						>
							{processing ? "Saving…" : children}
						</Button>
					</div>
					{errors.tracking && <FieldError>{errors.tracking}</FieldError>}
				</div>
			)}
		</Form>
	);
}

/**
 * Owners: set an item up for lot tracking (put the stock already on hand
 * into lots, then turn tracking on), or turn it off once its lots are empty.
 */
/**
 * Takes stock back out of a lot while the item is being set up: the undo of
 * putting it there. The item's total stays as it is.
 */
function ReleaseForm({
	item,
	lots,
	requestId,
	params,
}: {
	item: InventoryItem;
	lots: InventoryLot[];
	requestId: string;
	params: { tenant: string; id: string };
}) {
	const [choice, setChoice] = useState<string | null>(null);
	const lot = lots.find(({ id }) => id === choice) ?? lots[0];
	if (!lot) return null;
	return (
		<Form
			// A fresh quantity for each lot, and after each release.
			key={`${lot.id}:${lot.quantity}`}
			route="tenant.inventory.movement"
			routeParams={params}
			resetOnSuccess
		>
			{({ errors, processing }) => (
				<FieldGroup>
					<input type="hidden" name="requestId" value={requestId} />
					<input type="hidden" name="kind" value="release" />
					<input type="hidden" name="lotId" value={lot.id} />
					<div className="grid gap-4 sm:grid-cols-2">
						<Field data-invalid={!!errors.lotId}>
							<FieldLabel htmlFor="release-lot">
								Take stock back out of a lot
							</FieldLabel>
							<select
								id="release-lot"
								className="min-h-11 w-full min-w-0 rounded-md border bg-background px-3 text-sm"
								value={lot.id}
								onChange={(event) => setChoice(event.target.value)}
								aria-invalid={!!errors.lotId}
							>
								{lots.map((option) => (
									<option key={option.id} value={option.id}>
										{option.number} · {amount(option.quantity)} {item.unit}
									</option>
								))}
							</select>
							{errors.lotId && <FieldError>{errors.lotId}</FieldError>}
						</Field>
						<Field data-invalid={!!errors.quantity}>
							<FieldLabel htmlFor="release-quantity">
								Quantity ({item.unit})
							</FieldLabel>
							<Input
								id="release-quantity"
								name="quantity"
								type="number"
								min={0}
								max={amount(lot.quantity)}
								step="0.001"
								inputMode="decimal"
								defaultValue={amount(lot.quantity)}
								required
								aria-invalid={!!errors.quantity}
							/>
							{errors.quantity && <FieldError>{errors.quantity}</FieldError>}
						</Field>
					</div>
					<FieldDescription>
						For a wrong lot number or quantity: the stock goes back to "not in a
						lot", and the history keeps both steps. A wrong expiry date is
						corrected under the lot with "Change expiry".
					</FieldDescription>
					{errors.kind && <FieldError>{errors.kind}</FieldError>}
					<div>
						<Button
							type="submit"
							variant="outline"
							className="w-full sm:w-auto"
							disabled={processing}
						>
							{processing ? "Saving…" : "Take out of lot"}
						</Button>
					</div>
				</FieldGroup>
			)}
		</Form>
	);
}

export function LotTracking({
	item,
	lots,
	unassigned,
	requestId,
	params,
}: {
	item: InventoryItem;
	lots: InventoryLot[];
	unassigned: number;
	requestId: string;
	params: { tenant: string; id: string };
}) {
	if (item.tracking === "lot") {
		return (
			<div className="flex flex-col gap-3 text-sm">
				<p className="text-muted-foreground">
					Every receipt, use and count of this item names a lot. To go back to a
					single balance, use up or count every lot to zero first.
				</p>
				<TrackingButton
					params={params}
					tracking="standard"
					disabled={item.quantity > 0}
				>
					Turn off lot tracking
				</TrackingButton>
			</div>
		);
	}

	const assigned = item.quantity - unassigned;
	return (
		<div className="flex flex-col gap-6">
			<div className="flex flex-col gap-1 text-sm">
				<p className="text-muted-foreground">
					Track supplier lot numbers and expiry dates for this item. First put
					the stock you already have into lots, then turn tracking on. The
					item's total and its history stay as they are.
				</p>
				<p className="tabular-nums">
					{amount(item.quantity)} {item.unit} on hand · {amount(assigned)}{" "}
					{item.unit} in lots · {amount(unassigned)} {item.unit} not in a lot
				</p>
				{assigned > 0 && (
					<p className="text-muted-foreground">
						Stock already in a lot can't be used until lot tracking is on.
					</p>
				)}
			</div>
			{unassigned > 0 && (
				<Form
					// A fresh form after each assignment: its quantity starts at what is
					// still outside lots.
					key={unassigned}
					route="tenant.inventory.movement"
					routeParams={params}
					resetOnSuccess
				>
					{({ errors, processing }) => (
						<FieldGroup>
							<input type="hidden" name="requestId" value={requestId} />
							<input type="hidden" name="kind" value="assign" />
							{errors.requestId && <FieldError>{errors.requestId}</FieldError>}
							{errors.kind && <FieldError>{errors.kind}</FieldError>}
							<div className="grid gap-4 sm:grid-cols-3">
								<Field data-invalid={!!errors.lotNumber}>
									<FieldLabel htmlFor="assign-lot-number">
										Supplier lot number
									</FieldLabel>
									<Input
										id="assign-lot-number"
										name="lotNumber"
										maxLength={64}
										required
										autoComplete="off"
										aria-invalid={!!errors.lotNumber}
									/>
									{errors.lotNumber && (
										<FieldError>{errors.lotNumber}</FieldError>
									)}
								</Field>
								<Field data-invalid={!!errors.expiresOn}>
									<FieldLabel htmlFor="assign-expires">
										Expiry date (optional)
									</FieldLabel>
									<Input
										id="assign-expires"
										name="expiresOn"
										type="date"
										min="2000-01-01"
										max="2100-12-31"
										aria-invalid={!!errors.expiresOn}
									/>
									{errors.expiresOn && (
										<FieldError>{errors.expiresOn}</FieldError>
									)}
								</Field>
								<Field data-invalid={!!errors.quantity}>
									<FieldLabel htmlFor="assign-quantity">
										Quantity ({item.unit})
									</FieldLabel>
									<Input
										id="assign-quantity"
										name="quantity"
										type="number"
										min={0}
										max={amount(unassigned)}
										step="0.001"
										inputMode="decimal"
										defaultValue={amount(unassigned)}
										required
										aria-invalid={!!errors.quantity}
									/>
									{errors.quantity && (
										<FieldError>{errors.quantity}</FieldError>
									)}
								</Field>
							</div>
							<FieldDescription>
								A lot number already recorded for this item adds to that lot.
							</FieldDescription>
							{errors.lotId && <FieldError>{errors.lotId}</FieldError>}
							<div>
								<Button
									type="submit"
									variant="outline"
									className="w-full sm:w-auto"
									disabled={processing}
								>
									{processing ? "Saving…" : "Put stock in this lot"}
								</Button>
							</div>
						</FieldGroup>
					)}
				</Form>
			)}
			{lots.length > 0 && (
				<ReleaseForm
					item={item}
					lots={lots}
					requestId={requestId}
					params={params}
				/>
			)}
			<div className="flex flex-col gap-2 text-sm">
				{unassigned > 0 && (
					<p className="text-muted-foreground">
						Put the remaining {amount(unassigned)} {item.unit} in lots to turn
						tracking on.
					</p>
				)}
				<TrackingButton
					params={params}
					tracking="lot"
					disabled={unassigned > 0}
				>
					Turn on lot tracking
				</TrackingButton>
			</div>
		</div>
	);
}
