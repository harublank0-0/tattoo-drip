import { test } from "@japa/runner";
import {
	quoteTotal,
	artistDepositFloor as serverFloor,
} from "#modules/projects/quotes";
// @ts-expect-error TS6305: the server project only references the inertia project, so it cannot read its sources and the module is untyped here; `ProjectsModule` below restates its shape and the inertia project type-checks the real one.
import * as projectsModule from "../../../inertia/components/projects.js";

type ProjectsModule = {
	artistDepositFloor(total: number, percent: number | null): number;
	suggestedDeposit(total: number, percent: number | null): number;
	depositFloorHint(total: number, percent: number | null): string;
	depositAutofill(
		total: number,
		percent: number | null,
		floorApplies: boolean,
		current: number | null,
	): number;
	OWNER_ACCEPTS_NOTE: string;
};
const {
	artistDepositFloor: pageFloor,
	suggestedDeposit,
	depositFloorHint,
	depositAutofill,
	OWNER_ACCEPTS_NOTE,
} = projectsModule as ProjectsModule;

const PERCENTS = [null, 0, 1, 2, 5, 20, 33, 50, 99, 100];

/** Fixed totals in rupees, then hourly ones (rate x quarter hours, as the form multiplies them). */
const TOTALS: { rupees: number; paisa: bigint }[] = [
	1, 2, 3, 20, 99, 999, 1001, 3333, 15_000, 99_999, 1_000_000, 10_000_000,
].map((rupees) => ({ rupees, paisa: BigInt(rupees) * 100n }));
for (const rate of [1, 333, 1500, 2999]) {
	for (const hours of [0.25, 0.5, 1.75, 2.25, 4.5, 7]) {
		TOTALS.push({
			rupees: rate * hours,
			paisa: quoteTotal({
				kind: "hourly",
				fixedPrice: null,
				hourlyRate: rate * 100,
				estimatedMinutes: hours * 60,
			}),
		});
	}
}

test.group("The artist deposit floor on the page (TAT-16)", () => {
	test("the page's minimum is the server's, for every total and default", ({
		assert,
	}) => {
		for (const { rupees, paisa } of TOTALS) {
			for (const percent of PERCENTS) {
				assert.equal(
					pageFloor(rupees, percent) * 100,
					Number(serverFloor(paisa, percent)),
					`NPR ${rupees} at ${percent}%`,
				);
			}
		}
	});

	test("the minimum is never below what the form fills in, so the prefill always passes", ({
		assert,
	}) => {
		for (const { rupees } of TOTALS) {
			for (const percent of PERCENTS) {
				assert.isAtLeast(
					pageFloor(rupees, percent),
					suggestedDeposit(rupees, percent),
					`NPR ${rupees} at ${percent}%`,
				);
			}
		}
	});

	test("an artist's untouched deposit is never under the minimum, whatever the default (fix round 1)", ({
		assert,
	}) => {
		for (const { rupees, paisa } of TOTALS) {
			for (const percent of PERCENTS) {
				const filled = depositAutofill(rupees, percent, percent !== 0, null);
				assert.isAtLeast(
					filled * 100,
					Number(serverFloor(paisa, percent)),
					`NPR ${rupees} at ${percent}%`,
				);
			}
		}
		// The cases the server refused before: no default, and a share that rounds to nothing.
		assert.equal(depositAutofill(15_000, null, true, null), 1);
		assert.equal(depositAutofill(20, 1, true, null), 1);
		assert.equal(depositAutofill(Number.NaN, null, true, null), 1);
		// The usual case is what the form always suggested.
		assert.equal(depositAutofill(15_000, 20, true, null), 3000);
		// A 0% default has no minimum: the owner's own policy, so zero is filled in.
		assert.equal(depositAutofill(15_000, 0, false, null), 0);
	});

	test("a revision starts from the quote's deposit but never below an artist's minimum", ({
		assert,
	}) => {
		assert.equal(depositAutofill(15_000, 20, true, 5000), 5000);
		assert.equal(depositAutofill(15_000, 20, true, 0), 3000);
		assert.equal(depositAutofill(15_000, null, true, 0), 1);
		// The price went up: the old deposit is now under the minimum.
		assert.equal(depositAutofill(30_000, 20, true, 3000), 6000);
	});

	test("an owner's untouched deposit is what the form always filled in", ({
		assert,
	}) => {
		for (const { rupees } of TOTALS) {
			for (const percent of PERCENTS) {
				assert.equal(
					depositAutofill(rupees, percent, false, null),
					suggestedDeposit(rupees, percent),
				);
			}
		}
		assert.equal(depositAutofill(15_000, null, false, null), 0);
		assert.equal(depositAutofill(15_000, 20, false, 0), 0);
	});

	test("a 0% default has no minimum; without a default the minimum is NPR 1", ({
		assert,
	}) => {
		assert.equal(pageFloor(15_000, 0), 0);
		assert.equal(pageFloor(15_000, null), 1);
	});

	test("the Deposit note names the minimum and who can go lower", ({
		assert,
	}) => {
		assert.equal(
			depositFloorHint(15_000, 20),
			"At least NPR 3,000, your studio's 20% deposit. Only an owner can quote less or no deposit.",
		);
		assert.equal(
			depositFloorHint(1_500_000, 20),
			"At least NPR 3,00,000, your studio's 20% deposit. Only an owner can quote less or no deposit.",
		);
		assert.equal(
			depositFloorHint(15_000, null),
			"Only an owner can quote without a deposit.",
		);
		assert.equal(
			depositFloorHint(Number.NaN, 20),
			"At least your studio's 20% of the total. Only an owner can quote less or no deposit.",
		);
	});

	test("the Quote card says who confirms a quote under the minimum", ({
		assert,
	}) => {
		assert.equal(
			OWNER_ACCEPTS_NOTE,
			"An owner confirms this quote when the client agrees: its deposit is below what an artist can offer.",
		);
	});
});
