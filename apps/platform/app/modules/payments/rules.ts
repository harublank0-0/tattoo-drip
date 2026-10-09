import type { PaymentMethodKind } from "#modules/payments/models/payment_method";

export type DetailField = "accountName" | "accountNumber" | "bankName";
const DETAIL_FIELDS: DetailField[] = [
	"accountName",
	"accountNumber",
	"bankName",
];

export const KIND_NAMES: Record<PaymentMethodKind, string> = {
	fonepay: "Fonepay",
	esewa: "eSewa",
	khalti: "Khalti",
	bank: "Bank transfer",
	cash: "Cash",
};

/**
 * The details each kind keeps. eSewa and Khalti keep their wallet ID in
 * accountNumber, so that column is always "the number a client pays to".
 */
const KIND_FIELDS: Record<PaymentMethodKind, readonly DetailField[]> = {
	fonepay: [],
	esewa: ["accountNumber", "accountName"],
	khalti: ["accountNumber", "accountName"],
	bank: ["bankName", "accountName", "accountNumber"],
	cash: [],
};

const QR_KINDS: readonly PaymentMethodKind[] = [
	"fonepay",
	"esewa",
	"khalti",
	"bank",
];

/**
 * A payment method as it will be saved: after a new upload, with a QR
 * that's kept, or with one that's removed.
 */
export type PaymentMethodState = {
	kind: PaymentMethodKind;
	accountName: string | null;
	accountNumber: string | null;
	bankName: string | null;
	hasQr: boolean;
	showOnDepositPage: boolean;
};

export type RuleViolation = {
	field: "qr" | DetailField | "showOnDepositPage";
	message: string;
};

/**
 * The kind's own details from `input`; the others are null, so a row
 * never hides details its kind doesn't show.
 */
export function kindDetails(
	kind: PaymentMethodKind,
	input: Partial<Record<DetailField, string | null>>,
): Record<DetailField, string | null> {
	const kept = KIND_FIELDS[kind];
	const details = {} as Record<DetailField, string | null>;
	for (const field of DETAIL_FIELDS) {
		details[field] = kept.includes(field) ? (input[field] ?? null) : null;
	}
	return details;
}

/**
 * Every rule the method breaks, with a message for the user. Empty means
 * it can be saved.
 */
export function checkPaymentMethod(state: PaymentMethodState): RuleViolation[] {
	const violations: RuleViolation[] = [];
	const name = KIND_NAMES[state.kind];

	if (state.hasQr && !QR_KINDS.includes(state.kind)) {
		violations.push({
			field: "qr",
			message: `${name} doesn't take a QR code.`,
		});
	}

	switch (state.kind) {
		case "fonepay":
			if (!state.hasQr) {
				violations.push({
					field: "qr",
					message: "Upload your Fonepay QR code.",
				});
			}
			break;
		case "esewa":
		case "khalti":
			if (!state.hasQr && !state.accountNumber) {
				violations.push({
					field: "qr",
					message: `Add a QR code or your ${name} ID.`,
				});
			}
			break;
		case "bank":
			if (!state.bankName) {
				violations.push({
					field: "bankName",
					message: "Enter the bank's name.",
				});
			}
			if (!state.accountName) {
				violations.push({
					field: "accountName",
					message: "Enter the name on the account.",
				});
			}
			if (!state.accountNumber) {
				violations.push({
					field: "accountNumber",
					message: "Enter the account number.",
				});
			}
			break;
		case "cash":
			if (state.showOnDepositPage) {
				violations.push({
					field: "showOnDepositPage",
					message: "Cash can't be paid on the deposit page.",
				});
			}
			break;
	}

	return violations;
}
