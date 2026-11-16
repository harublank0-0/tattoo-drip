import { test } from "@japa/runner";
// @ts-expect-error TS6305: the server project only references the inertia project, so it cannot read its sources and the module is untyped here; `HistoryModule` below restates its shape and the inertia project type-checks the real one.
import * as historyModule from "../../../inertia/components/design_lab.js";

type HistoryCounts = {
	used: number;
	inProgress: number;
	failed: number;
	blocked: number;
};
type HistoryModule = {
	historyVariant(status: string): string;
	monthLabel(month: string): string;
	HISTORY_STATUS_LABELS: Record<string, string>;
	historyCountsText(counts: HistoryCounts, limit: number | null): string;
	historyQuery(
		filters: { month: string; artist: string | null; status: string | null },
		page: number,
		currentMonth: string,
	): string;
};
const {
	HISTORY_STATUS_LABELS,
	historyCountsText,
	historyQuery,
	historyVariant,
	monthLabel,
} = historyModule as HistoryModule;

const counts = { used: 23, inProgress: 1, failed: 3, blocked: 1 };

test.group("Design Lab history copy", () => {
	test("the summary reads the month's counts, with the limit when given", ({
		assert,
	}) => {
		assert.equal(
			historyCountsText(counts, 40),
			"23 of 40 used · 1 in progress · 3 failed · 1 blocked",
		);
		assert.equal(
			historyCountsText(counts, null),
			"23 used · 1 in progress · 3 failed · 1 blocked",
		);
	});

	test("the query string carries only what differs from the defaults", ({
		assert,
	}) => {
		assert.equal(
			historyQuery(
				{ month: "2026-11", artist: null, status: null },
				1,
				"2026-11",
			),
			"",
		);
		assert.equal(
			historyQuery(
				{ month: "2026-10", artist: "u1", status: "failed" },
				2,
				"2026-11",
			),
			"?month=2026-10&artist=u1&status=failed&page=2",
		);
	});

	test("every status has a label", ({ assert }) => {
		assert.deepEqual(HISTORY_STATUS_LABELS, {
			done: "Done",
			in_progress: "In progress",
			failed: "Failed",
			blocked: "Blocked",
		});
	});

	test("months read in words and failures look destructive", ({ assert }) => {
		assert.equal(monthLabel("2026-11"), "November 2026");
		assert.equal(monthLabel("2027-01"), "January 2027");
		assert.equal(historyVariant("done"), "default");
		assert.equal(historyVariant("in_progress"), "secondary");
		assert.equal(historyVariant("failed"), "destructive");
		assert.equal(historyVariant("blocked"), "destructive");
	});
});
