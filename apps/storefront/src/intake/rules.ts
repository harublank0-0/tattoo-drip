import type { SourceChannel } from "@tattoo-drip/sdk";
import { copy, fill } from "./copy.ts";

/*
 * What the intake form checks before it sends (TAT-57, spec ruling 4). The
 * API is the authority (TAT-51's intakeValidator); this mirrors its common
 * cases so a person sees a problem before a slow upload, not after.
 */

/** The longest each text field may be: the inquiry columns', pinned to openapi.yaml by its test. */
export const INTAKE_LIMITS = {
	idea: 4000,
	placement: 120,
	approximateSize: 120,
	preferredDates: 500,
	budget: 120,
	contactName: 120,
	contactPhone: 40,
	contactEmail: 254,
} as const;

/** How a person found the studio, in the contract's order. */
export const SOURCE_CHANNELS = [
	"instagram",
	"facebook",
	"tiktok",
	"google",
	"friend",
	"other",
] as const satisfies readonly SourceChannel[];

export interface IntakeValues {
	idea: string;
	placement: string;
	approximateSize: string;
	preferredDates: string;
	/** An artist's id, or "" for no preference. */
	preferredArtistId: string;
	budget: string;
	/** "" until the person picks one. */
	sourceChannel: SourceChannel | "";
	contactName: string;
	contactPhone: string;
	contactEmail: string;
}

export type IntakeField = keyof IntakeValues;
export type FieldErrors = Partial<Record<IntakeField, string>>;

/** The fields in the order the form shows them (the error summary keeps it). */
export const FIELD_ORDER: readonly IntakeField[] = [
	"idea",
	"placement",
	"approximateSize",
	"preferredDates",
	"preferredArtistId",
	"budget",
	"sourceChannel",
	"contactName",
	"contactPhone",
	"contactEmail",
];

/** The contract's required fields (InquiryInput), pinned by the test. */
export const REQUIRED_FIELDS: readonly IntakeField[] = [
	"idea",
	"placement",
	"approximateSize",
	"preferredDates",
	"sourceChannel",
	"contactName",
	"contactPhone",
];

/** What validateIntake needs besides the values. */
export interface IntakeRules {
	readonly studioName: string;
	/** The artists the person can choose (TAT-48's InquiryState.artists). */
	readonly artistIds: readonly string[];
}

/**
 * The form's starting answers. A flash request (`start`, TAT-129) begins with
 * the design's idea and size, which the client can still edit.
 */
export function initialValues(
	preferredArtistId: string | null,
	start: { idea: string; approximateSize: string } | null = null,
): IntakeValues {
	return {
		idea: start?.idea ?? "",
		placement: "",
		approximateSize: start?.approximateSize ?? "",
		preferredDates: "",
		preferredArtistId: preferredArtistId ?? "",
		budget: "",
		sourceChannel: "",
		contactName: "",
		contactPhone: "",
		contactEmail: "",
	};
}

/** Devanagari digits (a Nepali keyboard's) as ASCII ones; everything else unchanged. */
export function asciiDigits(value: string): string {
	return value.replace(/[०-९]/g, (digit) =>
		String(digit.charCodeAt(0) - 0x0966),
	);
}

// A copy of apps/platform/app/validators/phone.ts (the storefront can't
// import the platform); test/intake/rules.test.ts runs the platform's table.
const DEFAULT_COUNTRY_CODE = "977";
const E164 = /^\+[1-9]\d{7,14}$/;
const NEPALI_NATIONAL = /^\d{8,10}$/;
const NEPALI_WITH_CODE = /^977\d{8,10}$/;

/** The phone in E.164, or undefined if it can't be one (the platform's rule). */
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

/** Loose on purpose: the API checks the address properly. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Every problem with the values, one message per field. */
export function validateIntake(
	values: IntakeValues,
	rules: IntakeRules,
): FieldErrors {
	const errors: FieldErrors = {};
	for (const field of FIELD_ORDER) {
		const message = fieldError(field, values[field].trim(), rules);
		if (message) errors[field] = message;
	}
	return errors;
}

function fieldError(
	field: IntakeField,
	value: string,
	rules: IntakeRules,
): string | undefined {
	const studio = { studio: rules.studioName };
	if (value.includes("\u0000")) return copy.errors.nul;
	if (value === "") {
		const message = copy.errors.required[field];
		return message ? fill(message, studio) : undefined;
	}
	const max =
		field in INTAKE_LIMITS
			? INTAKE_LIMITS[field as keyof typeof INTAKE_LIMITS]
			: undefined;
	if (max !== undefined && value.length > max) {
		return fill(copy.errors.tooLong, { max });
	}
	switch (field) {
		case "contactPhone":
			return normalizePhone(asciiDigits(value)) ? undefined : copy.errors.phone;
		case "contactEmail":
			return EMAIL.test(value) ? undefined : copy.errors.email;
		case "preferredArtistId":
			return rules.artistIds.includes(value) ? undefined : copy.errors.artist;
		case "sourceChannel":
			return (SOURCE_CHANNELS as readonly string[]).includes(value)
				? undefined
				: fill(copy.errors.required.sourceChannel ?? "", studio);
		default:
			return undefined;
	}
}
