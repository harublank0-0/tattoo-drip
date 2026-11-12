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
import { ExpiryBadge } from "./expiry_badge";
import type { InventoryItem } from "./item_fields";
import {
	afterText,
	effectiveLot,
	expiryText,
	type InventoryLot,
	lotAfter,
	lotOption,
	type MovementKind,
	NEW_LOT,
} from "./lots";

const selectClass =
	"min-h-11 w-full min-w-0 rounded-md border bg-background px-3 text-sm";

/**
 * Receive, use or count stock. A lot-tracked item names its lot: an
 * existing one (usage starts on the suggested lot, the earliest expiry still
 * in date) or, when receiving, a new supplier lot number and expiry. The
 * chosen lot and what it will hold afterwards show before submitting.
 */
export function MovementForm({
	item,
	moreLots,
	lots,
	suggestedLotId,
	requestId,
	canManage,
	params,
}: {
	item: InventoryItem;
	/** More lots hold stock than `lots` offers (the first 100 by expiry). */
	moreLots: boolean;
	lots: InventoryLot[];
	suggestedLotId: string | null;
	requestId: string;
	canManage: boolean;
	params: { tenant: string; id: string };
}) {
	const tracked = item.tracking === "lot";
	const [kind, setKind] = useState<MovementKind>(canManage ? "receive" : "use");
	const [lotChoice, setLotChoice] = useState<string | null>(null);
	const [quantity, setQuantity] = useState("");
	const lotId = effectiveLot(lotChoice, kind, lots, suggestedLotId);
	const lot = lots.find((candidate) => candidate.id === lotId);
	const after = lot
		? afterText(lotAfter(kind, lot, quantity), item.unit)
		: null;
	const noLot = tracked && kind !== "receive" && !lot;

	return (
		<Form
			route="tenant.inventory.movement"
			routeParams={params}
			resetOnSuccess
			onSuccess={() => {
				setLotChoice(null);
				setQuantity("");
			}}
		>
			{({ errors, processing }) => (
				<FieldGroup>
					<input type="hidden" name="requestId" value={requestId} />
					{errors.requestId && <FieldError>{errors.requestId}</FieldError>}
					{canManage ? (
						<Field data-invalid={!!errors.kind}>
							<FieldLabel htmlFor="movement-kind">Movement</FieldLabel>
							<select
								id="movement-kind"
								name="kind"
								className={selectClass}
								value={kind}
								onChange={(event) =>
									setKind(event.target.value as MovementKind)
								}
								aria-invalid={!!errors.kind}
							>
								<option value="receive">Receive stock</option>
								<option value="use">Use stock</option>
								<option value="count">
									{tracked ? "Set counted stock in a lot" : "Set counted stock"}
								</option>
							</select>
							{errors.kind && <FieldError>{errors.kind}</FieldError>}
						</Field>
					) : (
						<input type="hidden" name="kind" value="use" />
					)}

					{tracked && (
						<Field data-invalid={!!errors.lotId}>
							<FieldLabel htmlFor="movement-lot">Lot</FieldLabel>
							{noLot ? (
								<p className="text-sm text-muted-foreground">
									No lot has stock to {kind === "count" ? "count" : "use"}.
									{canManage && " Receive stock into a lot first."}
								</p>
							) : (
								<select
									id="movement-lot"
									className={selectClass}
									value={lotId}
									onChange={(event) => setLotChoice(event.target.value)}
									aria-invalid={!!errors.lotId}
									aria-describedby={lot ? "movement-lot-summary" : undefined}
								>
									{kind === "receive" && (
										<option value={NEW_LOT}>New lot…</option>
									)}
									{lots.map((option) => (
										<option key={option.id} value={option.id}>
											{lotOption(
												option,
												item.unit,
												kind === "use" && option.id === suggestedLotId,
											)}
										</option>
									))}
								</select>
							)}
							{lot && <input type="hidden" name="lotId" value={lot.id} />}
							{moreLots && (
								<FieldDescription>
									Lists the 100 earliest-expiring lots. For another lot, open
									its History in the Lots list.
								</FieldDescription>
							)}
							{errors.lotId && <FieldError>{errors.lotId}</FieldError>}
							{lot && (
								<div
									id="movement-lot-summary"
									className="flex flex-col gap-1 rounded-md border p-3 text-sm"
									aria-live="polite"
								>
									<p className="flex flex-wrap items-center gap-2 font-medium wrap-anywhere">
										Lot {lot.number}
										<ExpiryBadge expiry={lot.expiry} />
									</p>
									<p className="tabular-nums">
										{lot.quantity / 1000} {item.unit} left · {expiryText(lot)}
									</p>
									{kind === "use" && lot.id === suggestedLotId && (
										<p className="text-muted-foreground">
											Suggested: the earliest expiry still in date.
										</p>
									)}
									{lot.expiry === "expired" && kind === "use" && (
										<p className="text-destructive">
											This lot has expired. Check before using it on a client.
										</p>
									)}
									{after && (
										<p className="text-muted-foreground tabular-nums">
											{after}
										</p>
									)}
								</div>
							)}
						</Field>
					)}

					{tracked && kind === "receive" && !lot && (
						<div className="grid gap-4 sm:grid-cols-2">
							<Field data-invalid={!!errors.lotNumber}>
								<FieldLabel htmlFor="movement-lot-number">
									Supplier lot number
								</FieldLabel>
								<Input
									id="movement-lot-number"
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
								<FieldLabel htmlFor="movement-expires">
									Expiry date (optional)
								</FieldLabel>
								<Input
									id="movement-expires"
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
						</div>
					)}

					<Field data-invalid={!!errors.quantity}>
						<FieldLabel htmlFor="movement-quantity">
							{kind === "count"
								? `Counted stock${tracked ? " in this lot" : ""} (${item.unit})`
								: `Quantity (${item.unit})`}
						</FieldLabel>
						<Input
							id="movement-quantity"
							name="quantity"
							type="number"
							min={0}
							max={2_000_000}
							step="0.001"
							inputMode="decimal"
							required
							value={quantity}
							onChange={(event) => setQuantity(event.target.value)}
							aria-invalid={!!errors.quantity}
						/>
						{errors.quantity && <FieldError>{errors.quantity}</FieldError>}
					</Field>
					<Field data-invalid={!!errors.note}>
						<FieldLabel htmlFor="movement-note">Note (optional)</FieldLabel>
						<Input
							id="movement-note"
							name="note"
							maxLength={240}
							aria-invalid={!!errors.note}
						/>
						{tracked && kind === "count" && (
							<FieldDescription>
								The difference is recorded against this lot and the item's
								total.
							</FieldDescription>
						)}
						{errors.note && <FieldError>{errors.note}</FieldError>}
					</Field>
					<div>
						<Button
							type="submit"
							className="w-full sm:w-auto"
							disabled={processing || noLot}
						>
							{processing ? "Saving…" : "Record movement"}
						</Button>
					</div>
				</FieldGroup>
			)}
		</Form>
	);
}
