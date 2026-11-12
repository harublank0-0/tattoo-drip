import { DateTime } from "luxon";

export const INVENTORY_UNITS = ["piece", "box", "roll", "ml", "g"] as const;
export const MOVEMENT_KINDS = [
	"receive",
	"use",
	"count",
	"assign",
	"release",
] as const;
export const TRACKING_MODES = ["standard", "lot"] as const;
export type InventoryUnit = (typeof INVENTORY_UNITS)[number];
export type MovementKind = (typeof MOVEMENT_KINDS)[number];
export type TrackingMode = (typeof TRACKING_MODES)[number];

export const MAX_STOCK = 2_000_000_000;
/** Up to 7 whole digits and 3 decimals; a phone keypad's ".5" too. */
export const QUANTITY_FORMAT = /^(?:\d{1,7}(?:\.\d{1,3})?|\.\d{1,3})$/;
export const QUANTITY_MESSAGE =
	"Enter a number with up to 3 decimal places, like 2.5.";
export const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

/** Lots expiring within this many days of the studio's today are flagged. */
export const EXPIRY_WARNING_DAYS = 30;

/** The most lots with stock the movement forms offer to choose. */
export const MAX_LISTED_LOTS = 100;

/** Lots per page in an item's Lots list. */
export const LOTS_PER_PAGE = 25;

export function toStockUnits(quantity: string) {
	return Math.round(Number(quantity) * 1000);
}

/** Thousandths of a unit, for people: 12500 and "ml" → "12.5 ml". */
export function stockLabel(amount: number, unit: string) {
	return `${amount / 1000} ${unit}`;
}

/** The last day (yyyy-MM-dd) that counts as expiring soon from `today`. */
export function expiryHorizon(today: string) {
	return DateTime.fromISO(today, { zone: "utc" })
		.plus({ days: EXPIRY_WARNING_DAYS })
		.toFormat("yyyy-MM-dd");
}

export type ExpiryStatus = "expired" | "soon" | null;

/**
 * Whether a lot's expiry date (yyyy-MM-dd) has passed or falls within the
 * warning window, given the studio's today. A lot is usable through its
 * expiry date and expired from the day after.
 */
export function expiryStatus(
	expiresOn: string | null,
	today: string,
): ExpiryStatus {
	if (!expiresOn) return null;
	if (expiresOn < today) return "expired";
	return expiresOn <= expiryHorizon(today) ? "soon" : null;
}

/** A real calendar date in yyyy-MM-dd between the years 2000 and 2100. */
export function isCalendarDate(value: string) {
	const date = DateTime.fromISO(value, { zone: "utc" });
	return (
		DATE_FORMAT.test(value) &&
		date.isValid &&
		date.year >= 2000 &&
		date.year <= 2100
	);
}
