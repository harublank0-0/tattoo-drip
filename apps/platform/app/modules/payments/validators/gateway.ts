import vine from "@vinejs/vine";
import {
	TRANSACTION_PROVIDERS,
	TRANSACTION_STATUSES,
	TRANSACTION_TYPES,
} from "#modules/payments/transactions";

/** The studio's PayBridgeNP secret key, as pasted. Checked with the API afterwards. */
export const connectGatewayValidator = vine.create({
	secretKey: vine.string().trim().minLength(10).maxLength(240),
	confirmOwnAccount: vine.accepted(),
});

const day = () =>
	vine
		.string()
		.trim()
		.regex(/^\d{4}-\d{2}-\d{2}$/)
		.nullable()
		.optional();

/** The Transactions page's query string; anything invalid falls back to the defaults. */
export const transactionFiltersValidator = vine.create({
	from: day(),
	to: day(),
	status: vine.enum(TRANSACTION_STATUSES).nullable().optional(),
	provider: vine.enum(TRANSACTION_PROVIDERS).nullable().optional(),
	type: vine.enum(TRANSACTION_TYPES).nullable().optional(),
	q: vine.string().trim().maxLength(100).nullable().optional(),
	page: vine.number().withoutDecimals().min(1).max(10_000).optional(),
});
