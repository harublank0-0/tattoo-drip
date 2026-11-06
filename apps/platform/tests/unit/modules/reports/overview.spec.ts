import { test } from "@japa/runner";
import { DateTime } from "luxon";
import { greetingText, overviewMetrics } from "#modules/reports/overview";

const KTM = "Asia/Kathmandu";
const at = (hour: number, minute = 0) =>
	DateTime.fromObject(
		{ year: 2026, month: 11, day: 6, hour, minute },
		{ zone: KTM },
	);
const session = (
	from: [number, number],
	to: [number, number],
	status = "scheduled",
) => ({ status, startsAt: at(...from), endsAt: at(...to) });

const base = {
	isOwner: true,
	today: [],
	now: at(9),
	timezone: KTM,
	needs: { requests: 0, projects: 0 },
	upcoming: { count: 0, first: null },
	artists: null,
};

test.group("Overview: the greeting", () => {
	test("follows the studio's hour, and the member's first name", ({
		assert,
	}) => {
		assert.equal(greetingText(9, "Priya Thapa"), "Good morning, Priya");
		assert.equal(greetingText(12, "Priya"), "Good afternoon, Priya");
		assert.equal(greetingText(16, "Priya"), "Good afternoon, Priya");
		assert.equal(greetingText(17, "Priya"), "Good evening, Priya");
		// A late session is still the evening.
		assert.equal(greetingText(2, "Priya"), "Good evening, Priya");
		assert.equal(greetingText(5, "Priya"), "Good morning, Priya");
	});

	test("without a name it is the greeting alone", ({ assert }) => {
		assert.equal(greetingText(9, null), "Good morning");
		assert.equal(greetingText(9, "   "), "Good morning");
	});
});

test.group("Overview: the summary strip", () => {
	test("an empty studio: real zeros and plain words, no artists number", ({
		assert,
	}) => {
		assert.deepEqual(overviewMetrics(base), [
			{
				key: "sessions",
				label: "Sessions today",
				value: "0",
				detail: "Nothing booked",
			},
			{ key: "needs", label: "Need you", value: "0", detail: "All caught up" },
			{
				key: "upcoming",
				label: "Next 7 days",
				value: "0",
				detail: "Nothing booked yet",
			},
		]);
	});

	test("today's sessions say who is in the chair, else what is next, else done", ({
		assert,
	}) => {
		const day = [
			session([10, 0], [12, 0], "completed"),
			session([13, 0], [15, 0]),
			session([16, 30], [18, 0]),
		];
		const detail = (now: DateTime) =>
			overviewMetrics({ ...base, today: day, now })[0];

		assert.deepEqual(detail(at(14)), {
			key: "sessions",
			label: "Sessions today",
			value: "3",
			detail: "1 in the chair now",
		});
		assert.equal(detail(at(15, 30)).detail, "Next at 16:30");
		assert.equal(detail(at(19)).detail, "All done for today");
	});

	test("Need you counts the requests and the projects once each", ({
		assert,
	}) => {
		const needs = (requests: number, projects: number) =>
			overviewMetrics({ ...base, needs: { requests, projects } })[1];
		assert.deepEqual(needs(3, 2), {
			key: "needs",
			label: "Need you",
			value: "5",
			detail: "3 requests, 2 projects",
		});
		assert.equal(needs(1, 0).detail, "1 request");
		assert.equal(needs(0, 1).detail, "1 project");
	});

	test("the next seven days name the first session, in the studio's time", ({
		assert,
	}) => {
		const first = DateTime.fromISO("2026-11-08T08:15:00Z");
		const [, , upcoming] = overviewMetrics({
			...base,
			upcoming: { count: 4, first },
		});
		// 08:15 UTC is 14:00 in Kathmandu (UTC+5:45).
		assert.deepEqual(upcoming, {
			key: "upcoming",
			label: "Next 7 days",
			value: "4",
			detail: "Next Sun 8 Nov, 14:00",
		});
	});

	test("artists in today: owners of a studio with two or more artists only", ({
		assert,
	}) => {
		const keys = (input: Partial<Parameters<typeof overviewMetrics>[0]>) =>
			overviewMetrics({ ...base, ...input }).map(({ key }) => key);

		const studio = overviewMetrics({
			...base,
			artists: { total: 3, busy: 2 },
		});
		assert.deepInclude(studio, {
			key: "artists",
			label: "Artists in today",
			value: "2 of 3",
			detail: "With a session today",
		});
		assert.notInclude(keys({ artists: { total: 1, busy: 1 } }), "artists");
		assert.notInclude(
			keys({ isOwner: false, artists: { total: 3, busy: 1 } }),
			"artists",
		);
	});
});
