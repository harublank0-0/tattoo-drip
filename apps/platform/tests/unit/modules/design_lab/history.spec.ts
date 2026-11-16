import { test } from "@japa/runner";
import { DateTime } from "luxon";
import {
	historyStatus,
	monthRange,
	parseHistoryFilters,
	personLabel,
} from "#modules/design_lab/history";

const now = DateTime.fromISO("2026-11-16T10:00:00Z");
const defaults = { month: "2026-11", artist: null, status: null, page: 1 };

test.group("Design Lab history rules", () => {
	test("no query gives the current UTC month, everyone, all statuses, page 1", ({
		assert,
	}) => {
		assert.deepEqual(parseHistoryFilters({}, now), defaults);
	});

	test("valid filters pass through", ({ assert }) => {
		assert.deepEqual(
			parseHistoryFilters(
				{
					month: "2026-10",
					artist: "0193a1b2-0000-7000-8000-000000000001",
					status: "blocked",
					page: "3",
				},
				now,
			),
			{
				month: "2026-10",
				artist: "0193a1b2-0000-7000-8000-000000000001",
				status: "blocked",
				page: 3,
			},
		);
	});

	test("a malformed value falls back to that field's default", ({ assert }) => {
		const cases: [Record<string, unknown>, keyof typeof defaults][] = [
			[{ month: "2026-13" }, "month"],
			[{ month: "2026-12" }, "month"],
			[{ month: "2019-12" }, "month"],
			[{ month: ["2026-10"] }, "month"],
			[{ artist: "x" }, "artist"],
			[{ status: "moderated" }, "status"],
			[{ page: "0" }, "page"],
			[{ page: "abc" }, "page"],
		];
		for (const [qs, field] of cases) {
			const filters = parseHistoryFilters(qs, now);
			assert.deepEqual(filters, defaults, `${JSON.stringify(qs)} (${field})`);
		}
	});

	test("monthRange is the UTC calendar month, end exclusive", ({ assert }) => {
		const { start, end } = monthRange("2026-02");
		assert.equal(start.toUTC().toISO(), "2026-02-01T00:00:00.000Z");
		assert.equal(end.toUTC().toISO(), "2026-03-01T00:00:00.000Z");
	});

	test("ledger rows map to history statuses", ({ assert }) => {
		assert.equal(historyStatus("settled", null), "done");
		assert.equal(historyStatus("reserved", null), "in_progress");
		assert.equal(historyStatus("released", "content_moderated"), "blocked");
		assert.equal(historyStatus("released", "request_moderated"), "blocked");
		assert.equal(historyStatus("released", "timed_out"), "failed");
		assert.equal(historyStatus("released", null), "failed");
	});

	test("people are labelled as current, former or deleted", ({ assert }) => {
		const sam = { fullName: "Sam Lee", email: "s@x.test" };
		const nameless = { fullName: null, email: "s@x.test" };
		assert.equal(personLabel(sam, false), "Sam Lee");
		assert.equal(personLabel(nameless, false), "s@x.test");
		assert.equal(personLabel(sam, true), "Sam Lee (former)");
		assert.equal(personLabel(nameless, true), "Former member");
		assert.equal(personLabel(null, false), "Deleted account");
	});
});
