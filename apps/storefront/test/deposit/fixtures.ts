import type { DepositPage } from "@tattoo-drip/sdk";

/** Shared by the deposit page's tests (TAT-65b). Later tasks add the page and the shell. */

/** A deposit link's token: 43 base64url characters. */
export const TOKEN = "tat65b-browser-pass-token-0123456789abcdefg";

export const QR_URL =
	"https://api.example.com/uploads/tenants/t/payment_qr/esewa.png";

/** A whole DepositPage (the contract's), due, with an eSewa QR and a bank account. */
export const PAGE: DepositPage = {
	studio: { name: "Black Needle" },
	project: {
		brief: "Fine line peony on the left forearm",
		artistName: "Sita Rai",
	},
	deposit: {
		amount: 300_000,
		amountText: "NPR 3,000",
		due: 300_000,
		dueText: "NPR 3,000",
		currency: "NPR",
		payBy: "2026-10-28",
		payByText: "28 Oct 2026",
	},
	referenceCode: "7K3M9Q",
	state: "due",
	lastProofRejected: false,
	proofSubmittedAt: null,
	paymentMethods: [
		{
			kind: "esewa",
			label: "eSewa",
			qrImageUrl: QR_URL,
			accountName: "Black Needle Pvt Ltd",
			accountNumber: "9812345678",
			bankName: null,
		},
		{
			kind: "bank",
			label: "Bank transfer",
			qrImageUrl: null,
			accountName: "Black Needle Pvt Ltd",
			accountNumber: "01234567890123",
			bankName: "Nabil Bank",
		},
	],
	depositPolicy:
		"Deposits hold your date.\nThey are kept if you cancel within 48 hours.",
	nextSession: null,
};

export const page = (overrides: Partial<DepositPage> = {}): DepositPage => ({
	...PAGE,
	...overrides,
});

/** What the route's loader gives the screen (src/deposit/loader.ts's DepositShell). */
export const SHELL = {
	studioName: "Black Needle",
	timezone: "Asia/Kathmandu",
	phone: "+9779812345678",
	logo: null,
};
