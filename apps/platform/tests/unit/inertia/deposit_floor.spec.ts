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
	OWNER_ACCEPTS_NOTE: string;
};
const {
	artistDepositFloor: pageFloor,
	suggestedDeposit,
	depositFloorHint,
	OWNER_ACCEPTS_NOTE,
} = projectsModule as ProjectsModule;

const PERCENTS = [null, 0, 1, 20, 33, 50, 99, 100];

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
