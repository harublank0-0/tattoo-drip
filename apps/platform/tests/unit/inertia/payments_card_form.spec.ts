import { test } from "@japa/runner";
// @ts-expect-error TS6305: the server project only references the inertia project, so it cannot read its sources and the module is untyped here; `PaymentsModule` below restates its shape and the inertia project type-checks the real one.
import * as paymentsModule from "../../../inertia/components/payments.js";

type Actions = {
	recordKinds: ("deposit" | "session" | "balance")[];
	depositDue: number | null;
	balanceDue: number | null;
};
type PaymentsModule = { recordFormKey(actions: Actions): string };
const { recordFormKey } = paymentsModule as PaymentsModule;

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
