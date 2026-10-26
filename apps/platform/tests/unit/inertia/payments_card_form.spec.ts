import { test } from "@japa/runner";
// @ts-expect-error TS6305: the server project only references the inertia project, so it cannot read its sources and the module is untyped here; `PaymentsModule` below restates its shape and the inertia project type-checks the real one.
import * as paymentsModule from "../../../inertia/components/payments.js";
// @ts-expect-error TS6305: as above, for `ProjectsModule`.
import * as projectsModule from "../../../inertia/components/projects.js";

type Actions = {
	recordKinds: ("deposit" | "session" | "balance")[];
	depositDue: number | null;
	balanceDue: number | null;
};
type PaymentsModule = { recordFormKey(actions: Actions): string };
const { recordFormKey } = paymentsModule as PaymentsModule;
type ProjectsModule = {
	refundLabel(amount: string): string;
	priceLabel(price: string): string;
};
const { refundLabel, priceLabel } = projectsModule as ProjectsModule;

const waiting: Actions = {
	recordKinds: ["deposit", "session", "balance"],
	depositDue: 3000,
	balanceDue: 15000,
};

test.group("recordFormKey", () => {
	test("is the same for the same choices, so typing and validation errors survive a refresh", ({
		assert,
	}) => {
		assert.equal(recordFormKey(waiting), recordFormKey({ ...waiting }));
	});

	test("changes when a deposit books the project and the deposit choice goes away", ({
		assert,
	}) => {
		const booked: Actions = {
			recordKinds: ["session", "balance"],
			depositDue: null,
			balanceDue: 12000,
		};
		assert.notEqual(recordFormKey(waiting), recordFormKey(booked));
	});

	test("changes when a payment lands and the suggested amounts move", ({
		assert,
	}) => {
		assert.notEqual(
			recordFormKey(waiting),
			recordFormKey({ ...waiting, balanceDue: 12000 }),
		);
		assert.notEqual(
			recordFormKey(waiting),
			recordFormKey({ ...waiting, depositDue: null }),
		);
	});
});

// TAT-108: a money form in a sheet confirms by naming the amount on its button.
test.group("refundLabel and priceLabel", () => {
	test("a refund's button names the amount typed", ({ assert }) => {
		assert.equal(refundLabel("2000"), "Record refund of NPR 2,000");
		assert.equal(refundLabel(" 1500 "), "Record refund of NPR 1,500");
		assert.equal(refundLabel("150000"), "Record refund of NPR 1,50,000");
		assert.equal(refundLabel("2500.5"), "Record refund of NPR 2,500.5");
	});

	test("a refund's button names nothing that is not an amount", ({
		assert,
	}) => {
		for (const typed of ["", "   ", "0", "-5", "abc", "1e999", "NaN"]) {
			assert.equal(refundLabel(typed), "Record refund", typed);
		}
	});

	test("the price's button names the price typed", ({ assert }) => {
		assert.equal(priceLabel("15000"), "Set the price to NPR 15,000");
		assert.equal(priceLabel(" 8000"), "Set the price to NPR 8,000");
	});

	test("the price's button names nothing that is not a price", ({ assert }) => {
		for (const typed of ["", "0", "-1", "ten", "Infinity"]) {
			assert.equal(priceLabel(typed), "Set price", typed);
		}
	});
});
