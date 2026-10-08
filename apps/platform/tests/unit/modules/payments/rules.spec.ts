import { test } from "@japa/runner";
import {
	checkPaymentMethod,
	kindDetails,
	type PaymentMethodState,
} from "#modules/payments/rules";

const none = {
	accountName: null,
	accountNumber: null,
	bankName: null,
	hasQr: false,
	showOnDepositPage: false,
};
const bankDetails = {
	bankName: "Nabil Bank",
	accountName: "Black Needle Pvt. Ltd.",
	accountNumber: "0123456789",
};

test.group("checkPaymentMethod", () => {
	const cases: [string, PaymentMethodState, string[]][] = [
		["fonepay with a QR", { ...none, kind: "fonepay", hasQr: true }, []],
		[
			"fonepay with a QR, on the deposit page",
			{ ...none, kind: "fonepay", hasQr: true, showOnDepositPage: true },
			[],
		],
		["fonepay without a QR", { ...none, kind: "fonepay" }, ["qr"]],
		["esewa with only a QR", { ...none, kind: "esewa", hasQr: true }, []],
		[
			"esewa with only a wallet ID",
			{ ...none, kind: "esewa", accountNumber: "9812345678" },
			[],
		],
		["esewa with neither", { ...none, kind: "esewa" }, ["qr"]],
		[
			"khalti with only a wallet ID",
			{ ...none, kind: "khalti", accountNumber: "9812345678" },
			[],
		],
		["khalti with neither", { ...none, kind: "khalti" }, ["qr"]],
		["bank with every detail", { ...none, kind: "bank", ...bankDetails }, []],
		[
			"bank with every detail and a QR",
			{ ...none, kind: "bank", ...bankDetails, hasQr: true },
			[],
		],
		[
			"bank with nothing",
			{ ...none, kind: "bank" },
			["bankName", "accountName", "accountNumber"],
		],
		[
			"bank without an account number",
			{ ...none, kind: "bank", ...bankDetails, accountNumber: null },
			["accountNumber"],
		],
		["cash", { ...none, kind: "cash" }, []],
		[
			"cash on the deposit page",
			{ ...none, kind: "cash", showOnDepositPage: true },
			["showOnDepositPage"],
		],
		["cash with a QR", { ...none, kind: "cash", hasQr: true }, ["qr"]],
	];

	for (const [name, state, fields] of cases) {
		test(name, ({ assert }) => {
			assert.deepEqual(
				checkPaymentMethod(state).map(({ field }) => field),
				fields,
			);
		});
	}

	test("messages name the kind", ({ assert }) => {
		assert.deepEqual(checkPaymentMethod({ ...none, kind: "esewa" }), [
			{ field: "qr", message: "Add a QR code or your eSewa ID." },
		]);
		assert.deepEqual(checkPaymentMethod({ ...none, kind: "fonepay" }), [
			{ field: "qr", message: "Upload your Fonepay QR code." },
		]);
		assert.deepEqual(
			checkPaymentMethod({ ...none, kind: "cash", hasQr: true }),
			[{ field: "qr", message: "Cash doesn't take a QR code." }],
		);
	});
});

test.group("kindDetails", () => {
	const everything = {
		accountName: "Black Needle",
		accountNumber: "0123456789",
		bankName: "Nabil Bank",
	};

	test("fonepay and cash keep no details", ({ assert }) => {
		for (const kind of ["fonepay", "cash"] as const) {
			assert.deepEqual(kindDetails(kind, everything), {
				accountName: null,
				accountNumber: null,
				bankName: null,
			});
		}
	});

	test("esewa and khalti keep the wallet ID and account name", ({ assert }) => {
		for (const kind of ["esewa", "khalti"] as const) {
			assert.deepEqual(kindDetails(kind, everything), {
				accountName: "Black Needle",
				accountNumber: "0123456789",
				bankName: null,
			});
		}
	});

	test("bank keeps every detail, and missing ones become null", ({
		assert,
	}) => {
		assert.deepEqual(kindDetails("bank", everything), everything);
		assert.deepEqual(kindDetails("bank", {}), {
			accountName: null,
			accountNumber: null,
			bankName: null,
		});
	});
});
