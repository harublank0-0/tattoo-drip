import { test } from "@japa/runner";
import { EXPIRING_STATUSES, expiryCancels } from "#modules/projects/expiry";
import {
	PROJECT_STATUSES,
	type ProjectStatus,
} from "#modules/projects/models/tattoo_project";

const cancels = (
	status: ProjectStatus,
	depositAmount: number,
	depositSettled: boolean,
) => expiryCancels({ status, depositAmount, depositSettled });

test.group("expiryCancels (the rule the sweep and Today share)", () => {
	test("only quoted, on_hold and deposit_pending projects can be cancelled", ({
		assert,
	}) => {
		assert.deepEqual(
			[...EXPIRING_STATUSES],
			["quoted", "on_hold", "deposit_pending"],
		);
		for (const status of PROJECT_STATUSES) {
			if (EXPIRING_STATUSES.includes(status)) continue;
			assert.isFalse(cancels(status, 300_000, false), status);
			assert.isFalse(cancels(status, 0, true), status);
		}
	});

	test("a deposit_pending project is cancelled unless its deposit is covered", ({
		assert,
	}) => {
		assert.isTrue(cancels("deposit_pending", 300_000, false));
		assert.isFalse(cancels("deposit_pending", 300_000, true));
		// A zero deposit is covered by definition: booking waits on a session only.
		assert.isFalse(cancels("deposit_pending", 0, true));
	});

	test("a quoted or on_hold project is cancelled unless a non-zero deposit was paid", ({
		assert,
	}) => {
		for (const status of ["quoted", "on_hold"] as const) {
			assert.isTrue(cancels(status, 300_000, false), `${status} unpaid`);
			assert.isFalse(cancels(status, 300_000, true), `${status} paid`);
			// "Settled" with a zero deposit means nobody paid: nothing is spared.
			assert.isTrue(cancels(status, 0, true), `${status} zero deposit`);
		}
	});
});
