import vine from "@vinejs/vine";
import type { FieldContext } from "@vinejs/vine/types";

/**
 * Nepal, where the pilot studios are (database/README.md).
 */
const DEFAULT_COUNTRY_CODE = "977";
const E164 = /^\+[1-9]\d{7,14}$/;
/** A Nepali number without the trunk 0: 8-digit landline to 10-digit mobile. */
const NEPALI_NATIONAL = /^\d{8,10}$/;
/** Country code 977 typed without "+": 11-13 digits, longer than any national number. */
const NEPALI_WITH_CODE = /^977\d{8,10}$/;

/**
 * A phone number in E.164 form ("+9779812345678"), or undefined if it
 * can't be one. Spaces, dashes, dots and brackets are dropped; "00" starts
 * an international number; 977 followed by a Nepali number is taken as
 * the country code without its "+"; any other number without a country
 * code is Nepali, with its trunk 0 dropped. It checks the shape only, not numbering plans.
 */
export function normalizePhone(value: string): string | undefined {
	const compact = value.replace(/[\s\-.()]/g, "");
	if (compact.startsWith("+")) {
		return E164.test(compact) ? compact : undefined;
	}
	if (compact.startsWith("00")) {
		const international = `+${compact.slice(2)}`;
		return E164.test(international) ? international : undefined;
	}
	if (compact.length > 10 && NEPALI_WITH_CODE.test(compact)) {
		return `+${compact}`;
	}
	const national = compact.replace(/^0/, "");
	return NEPALI_NATIONAL.test(national)
		? `+${DEFAULT_COUNTRY_CODE}${national}`
		: undefined;
}

/**
 * Accepts a phone number the way people type it and stores it in E.164.
 */
export const phoneNumber = vine.createRule(
	(value: unknown, _, field: FieldContext) => {
		const phone = typeof value === "string" ? normalizePhone(value) : undefined;
		if (!phone) {
			field.report(
				"Enter a phone number, like 9812345678 or +977 1 4123456.",
				"phoneNumber",
				field,
			);
			return;
		}
		field.mutate(phone, field);
	},
);
