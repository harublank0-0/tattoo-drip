/**
 * A payment method as the settings pages get it.
 */
export type PaymentMethodProps = {
	id: string;
	kind: string;
	label: string;
	accountName: string | null;
	accountNumber: string | null;
	bankName: string | null;
	showOnDepositPage: boolean;
	qrUrl: string | null;
};

export type DetailField = "bankName" | "accountName" | "accountNumber";

type KindCopy = {
	name: string;
	description: string;
	/** The detail inputs to show, in order. */
	fields: DetailField[];
	qr: "required" | "optional" | "none";
	/** Whether it can be shown on the deposit page. */
	depositPage: boolean;
};

/**
 * Wording and inputs for each kind. The server decides what's valid
 * (app/modules/payments/rules.ts); this only picks what to show. A kind
 * without copy here still shows, with its raw value as the name.
 */
const KINDS: Record<string, KindCopy> = {
	fonepay: {
		name: "Fonepay",
		description: "Your Fonepay merchant QR code.",
		fields: [],
		qr: "required",
		depositPage: true,
	},
	esewa: {
		name: "eSewa",
		description: "Your eSewa QR code or eSewa ID.",
		fields: ["accountNumber", "accountName"],
		qr: "optional",
		depositPage: true,
	},
	khalti: {
		name: "Khalti",
		description: "Your Khalti QR code or Khalti ID.",
		fields: ["accountNumber", "accountName"],
		qr: "optional",
		depositPage: true,
	},
	bank: {
		name: "Bank transfer",
		description: "Account details, with a QR code if your bank gives one.",
		fields: ["bankName", "accountName", "accountNumber"],
		qr: "optional",
		depositPage: true,
	},
	cash: {
		name: "Cash",
		description: "Paid in person at the studio.",
		fields: [],
		qr: "none",
		depositPage: false,
	},
};

export function kindCopy(kind: string): KindCopy {
	return (
		KINDS[kind] ?? {
			name: kind,
			description: "",
			fields: [],
			qr: "optional",
			depositPage: true,
		}
	);
}

/**
 * The label for a detail input. eSewa and Khalti call the number an ID.
 */
export function fieldLabel(kind: string, field: DetailField): string {
	if (field === "accountNumber" && (kind === "esewa" || kind === "khalti")) {
		return `${kindCopy(kind).name} ID`;
	}
	return {
		bankName: "Bank name",
		accountName: "Account name",
		accountNumber: "Account number",
	}[field];
}
