/**
 * Lot choices and their words for the inventory item page. Plain module (no
 * `~/` imports) so tests/unit/inertia can load it.
 */

export type ExpiryStatus = "expired" | "soon" | null;

export type InventoryLot = {
	id: string;
	number: string;
	/** Thousandths of the item's unit. */
	quantity: number;
	expiresOn: string | null;
	expiresLabel: string | null;
	expiry: ExpiryStatus;
};

export type MovementKind = "receive" | "use" | "count";

/** The receive form's choice for a lot that isn't recorded yet. */
export const NEW_LOT = "new";

const amount = (thousandths: number) => (thousandths / 1000).toString();

/**
 * The lot a movement form starts on: a new lot when receiving (a delivery
 * is usually a new batch), else the suggested lot (the earliest expiry still
 * in date), else the first lot listed.
 */
export function defaultLot(
	kind: MovementKind,
	lots: readonly InventoryLot[],
	suggestedLotId: string | null,
) {
	if (kind === "receive") return NEW_LOT;
	return suggestedLotId ?? lots[0]?.id ?? "";
}

/** A chosen lot that still exists for this kind, or the default. */
export function effectiveLot(
	choice: string | null,
	kind: MovementKind,
	lots: readonly InventoryLot[],
	suggestedLotId: string | null,
) {
	const valid =
		choice !== null &&
		((choice === NEW_LOT && kind === "receive") ||
			lots.some((lot) => lot.id === choice));
	return valid ? choice : defaultLot(kind, lots, suggestedLotId);
}

export function expiryText(lot: Pick<InventoryLot, "expiresLabel" | "expiry">) {
	if (!lot.expiresLabel) return "No expiry date";
	return lot.expiry === "expired"
		? `Expired ${lot.expiresLabel}`
		: `Expires ${lot.expiresLabel}`;
}

/** One line per lot in a picker: "A123 · 12.5 ml · Expires 3 Dec 2026". */
export function lotOption(lot: InventoryLot, unit: string, suggested: boolean) {
	return [
		lot.number,
		`${amount(lot.quantity)} ${unit}`,
		expiryText(lot),
		...(suggested ? ["Suggested"] : []),
	].join(" · ");
}

/**
 * What the chosen lot will hold after the movement, for the summary shown
 * before submitting; null while the quantity is not a number.
 */
export function lotAfter(
	kind: MovementKind,
	lot: Pick<InventoryLot, "quantity">,
	quantity: string,
) {
	if (!/^\d{1,7}(?:\.\d{1,3})?$/.test(quantity.trim())) return null;
	const change = Math.round(Number(quantity) * 1000);
	if (kind === "count") return change;
	return lot.quantity + (kind === "receive" ? change : -change);
}

export function afterText(after: number | null, unit: string) {
	if (after === null) return null;
	return after < 0
		? "More than this lot holds."
		: `After this: ${amount(after)} ${unit} left in this lot.`;
}
