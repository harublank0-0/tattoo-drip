import { test } from "@japa/runner";
import {
	DEPOSIT_STATES,
	type DepositFacts,
	depositState,
} from "#modules/payments/deposit_page";
import {
	PROJECT_STATUSES,
	type ProjectStatus,
} from "#modules/projects/models/tattoo_project";

const facts = (over: Partial<DepositFacts> = {}): DepositFacts => ({
	status: "deposit_pending",
	quoteExpired: false,
	settled: false,
	proofPending: false,
	...over,
});

test.group("depositState", () => {
	test("deposit_pending is due with a live quote, expired with an expired one", ({
		assert,
	}) => {
		assert.equal(depositState(facts()), "due");
		assert.equal(depositState(facts({ quoteExpired: true })), "expired");
	});

	test("a waiting screenshot is submitted, whatever the quote did since", ({
		assert,
	}) => {
		assert.equal(depositState(facts({ proofPending: true })), "submitted");
		assert.equal(
			depositState(facts({ proofPending: true, quoteExpired: true })),
			"submitted",
		);
		assert.equal(
			depositState(facts({ status: "quoted", proofPending: true })),
			"submitted",
		);
	});

	test("nothing left to pay is paid, also after a revision sent the project back to quoted (TAT-64)", ({
		assert,
	}) => {
		for (const status of [
			"deposit_pending",
			"quoted",
			"on_hold",
			"booked",
			"in_progress",
			"completed",
			"healing_check",
		] as ProjectStatus[]) {
			assert.equal(
				depositState(facts({ status, settled: true })),
				"paid",
				status,
			);
		}
		assert.equal(
			depositState(facts({ settled: true, proofPending: true })),
			"paid",
			"a screenshot waiting on a paid deposit changes nothing for the client",
		);
	});

	test("cancelled and declined are cancelled, even when paid", ({ assert }) => {
		for (const status of ["cancelled", "declined"] as ProjectStatus[]) {
			assert.equal(depositState(facts({ status })), "cancelled", status);
			assert.equal(
				depositState(facts({ status, settled: true, proofPending: true })),
				"cancelled",
				status,
			);
		}
	});

	test("any other status with the deposit not covered is updating", ({
		assert,
	}) => {
		for (const status of [
			"reviewing",
			"quoted",
			"on_hold",
			"booked",
			"in_progress",
			"completed",
			"healing_check",
		] as ProjectStatus[]) {
			assert.equal(depositState(facts({ status })), "updating", status);
		}
	});

	test("every combination gives one of DEPOSIT_STATES", ({ assert }) => {
		for (const status of PROJECT_STATUSES) {
			for (const quoteExpired of [false, true]) {
				for (const settled of [false, true]) {
					for (const proofPending of [false, true]) {
						assert.include(
							DEPOSIT_STATES,
							depositState({ status, quoteExpired, settled, proofPending }),
						);
					}
				}
			}
		}
	});
});
