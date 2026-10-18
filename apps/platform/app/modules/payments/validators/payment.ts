import vine, { errors, SimpleMessagesProvider } from "@vinejs/vine";
import type { Infer } from "@vinejs/vine/types";
import { DESK_KINDS } from "#modules/payments/models/payment";
import { PAYMENT_METHOD_KINDS } from "#modules/payments/models/payment_method";
import type { OutcomeInput } from "#modules/payments/services/payment_service";

export const AMOUNT_MESSAGE =
	"Enter an amount from 0.01 to 1,00,00,000 rupees, with at most 2 decimals.";
const METHOD_MESSAGE = "Choose how it was paid.";
const NOTE_MESSAGE = "Keep it under 500 characters.";

/** Rupees with paisa, as a form sends them: 0.01 to 1,00,00,000. */
const amount = () => vine.number().min(0.01).max(10_000_000).decimal([0, 2]);
/** An optional staff note; an empty box arrives as null. */
const note = () => vine.string().trim().maxLength(500).nullable().optional();
const method = () => vine.enum(PAYMENT_METHOD_KINDS);

/**
 * Rupees from a form in stored paisa. Rounded, because 0.29 × 100 is
 * 28.999… in floating point; the validator allows at most 2 decimals.
 */
export const toPaisa = (rupees: number) => Math.round(rupees * 100);

const AMOUNT_MESSAGES = {
	"amount.required": AMOUNT_MESSAGE,
	"amount.number": AMOUNT_MESSAGE,
	"amount.min": AMOUNT_MESSAGE,
	"amount.max": AMOUNT_MESSAGE,
	"amount.decimal": AMOUNT_MESSAGE,
};
const SHARED_MESSAGES = {
	"method.required": METHOD_MESSAGE,
	"method.enum": METHOD_MESSAGE,
	"note.maxLength": NOTE_MESSAGE,
};

/** Verify, reject and reverse: an optional note. */
export const decisionValidator = vine.create({ note: note() });
decisionValidator.messagesProvider = new SimpleMessagesProvider({
	"note.maxLength": NOTE_MESSAGE,
});

/** Money taken at the desk. */
export const deskPaymentValidator = vine.create({
	kind: vine.enum(DESK_KINDS),
	method: method(),
	amount: amount(),
	note: note(),
});
deskPaymentValidator.messagesProvider = new SimpleMessagesProvider({
	"kind.required": "Choose what was paid.",
	"kind.enum": "Choose what was paid.",
	...AMOUNT_MESSAGES,
	...SHARED_MESSAGES,
});

/** Money given back. */
export const refundValidator = vine.create({
	method: method(),
	amount: amount(),
	note: note(),
});
refundValidator.messagesProvider = new SimpleMessagesProvider({
	...AMOUNT_MESSAGES,
	...SHARED_MESSAGES,
});

/** A closed project's deposit: kept, or refunded with an amount and a method (toOutcomeInput). */
export const outcomeValidator = vine.create({
	outcome: vine.enum(["kept", "refunded"] as const),
	method: method().optional(),
	amount: amount().optional(),
	note: note(),
});
outcomeValidator.messagesProvider = new SimpleMessagesProvider({
	"outcome.required": "Choose what happened to the deposit.",
	"outcome.enum": "Choose what happened to the deposit.",
	...AMOUNT_MESSAGES,
	...SHARED_MESSAGES,
});

export type OutcomeForm = Infer<typeof outcomeValidator>;

/**
 * The service's input from the outcome form, in paisa. A refund needs its
 * amount and its method: E_VALIDATION_ERROR on each missing field, shown
 * next to it.
 */
export function toOutcomeInput(form: OutcomeForm): OutcomeInput {
	const text = form.note ?? null;
	if (form.outcome === "kept") return { outcome: "kept", note: text };
	const problems: { field: string; message: string; rule: string }[] = [];
	if (form.amount == null) {
		problems.push({
			field: "amount",
			message: AMOUNT_MESSAGE,
			rule: "required",
		});
	}
	if (form.method == null) {
		problems.push({
			field: "method",
			message: METHOD_MESSAGE,
			rule: "required",
		});
	}
	if (problems.length > 0 || form.amount == null || form.method == null) {
		throw new errors.E_VALIDATION_ERROR(problems);
	}
	return {
		outcome: "refunded",
		amount: toPaisa(form.amount),
		method: form.method,
		note: text,
	};
}
