import vine, { SimpleMessagesProvider } from "@vinejs/vine";
import type { FieldContext } from "@vinejs/vine/types";
import { IANAZone } from "luxon";
import { TENANT_TYPES } from "#modules/tenancy/models/tenant";
import { phoneNumber } from "#validators/phone";

/**
 * Node's ICU still lists some zones under old CLDR names (it returns
 * "Asia/Katmandu", not "Asia/Kathmandu"). Show the current IANA names.
 */
const CURRENT_NAMES: Record<string, string> = {
	"Asia/Calcutta": "Asia/Kolkata",
	"Asia/Katmandu": "Asia/Kathmandu",
	"Asia/Rangoon": "Asia/Yangon",
	"Asia/Saigon": "Asia/Ho_Chi_Minh",
	"Europe/Kiev": "Europe/Kyiv",
};

/**
 * Time zones offered in the onboarding select, with current IANA names.
 */
export const TIMEZONES = Intl.supportedValuesOf("timeZone")
	.map((zone) => CURRENT_NAMES[zone] ?? zone)
	.sort();

/**
 * The canonical current name for any spelling Intl accepts: any case,
 * old names and aliases ("asia/KATHMANDU", "Asia/Katmandu" and
 * "Asia/Kathmandu" all give "Asia/Kathmandu"; "US/Eastern" gives
 * "America/New_York"). Undefined if the zone is unknown.
 */
function canonicalTimezone(value: string): string | undefined {
	if (!IANAZone.isValidZone(value)) return undefined;
	const resolved = new Intl.DateTimeFormat("en", {
		timeZone: value,
	}).resolvedOptions().timeZone;
	return CURRENT_NAMES[resolved] ?? resolved;
}

/**
 * Accepts any spelling of a zone in TIMEZONES and stores its canonical
 * name, so the select can show it again and zones compare equal.
 */
const ianaTimezone = vine.createRule(
	(value: unknown, _, field: FieldContext) => {
		const zone =
			typeof value === "string" ? canonicalTimezone(value) : undefined;
		if (!zone || !TIMEZONES.includes(zone)) {
			field.report("The selected timezone is invalid", "timezone", field);
			return;
		}
		field.mutate(zone, field);
	},
);

/**
 * A slug is also the tenant's subdomain, so it follows DNS label rules:
 * 3-63 lowercase letters, digits and hyphens, not starting or ending with
 * a hyphen. Reserved names arrive with TAT-24.
 */
const SLUG = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

export const createTenantValidator = vine.create({
	name: vine.string().trim().minLength(2).maxLength(120),
	type: vine.enum(TENANT_TYPES),
	slug: vine
		.string()
		.trim()
		.toLowerCase()
		.regex(SLUG)
		// Checks deleted tenants too: their slugs stay reserved.
		.unique({ table: "tenants", column: "slug" }),
	timezone: vine.string().trim().use(ianaTimezone()),
});

/**
 * The page calls the slug "your address", so the errors do too.
 */
createTenantValidator.messagesProvider = new SimpleMessagesProvider(
	{
		// Lucid's unique rule reports as "database.unique".
		"slug.database.unique": "This address is already taken. Try another one.",
		"slug.regex":
			"Use 3 to 63 lowercase letters, numbers and hyphens, not starting or ending with a hyphen.",
	},
	{ name: "business name", slug: "address", timezone: "time zone" },
);

/**
 * A full link to a profile or site. https only: the storefront links to it.
 */
const httpsUrl = () =>
	vine
		.string()
		.trim()
		.maxLength(500)
		.url({ protocols: ["https"], require_protocol: true });

/**
 * The studio profile form. Every field is sent; an empty one arrives as
 * null and clears the column. Slug and type can't be changed here.
 */
export const updateProfileValidator = vine.create({
	name: vine.string().trim().minLength(2).maxLength(120),
	timezone: vine.string().trim().use(ianaTimezone()),
	intro: vine.string().trim().maxLength(1000).nullable(),
	contactPhone: vine.string().trim().use(phoneNumber()).nullable(),
	contactEmail: vine.string().trim().maxLength(254).email().nullable(),
	address: vine.string().trim().maxLength(300).nullable(),
	instagramUrl: httpsUrl().nullable(),
	facebookUrl: httpsUrl().nullable(),
	tiktokUrl: httpsUrl().nullable(),
	websiteUrl: httpsUrl().nullable(),
});

updateProfileValidator.messagesProvider = new SimpleMessagesProvider(
	{ url: "Enter a full link that starts with https://" },
	{
		name: "business name",
		timezone: "time zone",
		contactPhone: "phone number",
		contactEmail: "email",
	},
);

/**
 * The deposit defaults on the Payments settings page.
 */
export const updateDepositSettingsValidator = vine.create({
	defaultDepositPercent: vine
		.number()
		.withoutDecimals()
		.range([0, 100])
		.nullable(),
	depositPolicy: vine.string().trim().maxLength(2000).nullable(),
});

const DEPOSIT_PERCENT_MESSAGE = "Enter a whole number from 0 to 100.";
updateDepositSettingsValidator.messagesProvider = new SimpleMessagesProvider({
	"defaultDepositPercent.number": DEPOSIT_PERCENT_MESSAGE,
	"defaultDepositPercent.withoutDecimals": DEPOSIT_PERCENT_MESSAGE,
	"defaultDepositPercent.range": DEPOSIT_PERCENT_MESSAGE,
});
