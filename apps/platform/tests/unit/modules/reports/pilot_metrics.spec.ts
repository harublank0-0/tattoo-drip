import { test } from "@japa/runner";
import { DateTime } from "luxon";
import {
	combineFacts,
	durationText,
	lastDays,
	linkShare,
	median,
	noFacts,
	noShowRate,
	type PilotFacts,
	percentText,
	pilotCard,
	pilotLines,
} from "#modules/reports/pilot_metrics";

const facts = (over: Partial<PilotFacts> = {}): PilotFacts => ({
	...noFacts(),
	...over,
});

const busy = facts({
	linkInquiries: 12,
	deskProjects: 4,
	depositHours: [10, 50, 60, 70, 200, 30, 90, 80],
	sessions: { completed: 23, noShow: 2, noOutcome: 3 },
});

test.group("pilot metrics: arithmetic", () => {
	test("lastDays is the N × 24 hours before now, half-open", ({ assert }) => {
		const now = DateTime.fromISO("2026-10-20T09:30:00Z");
		const { from, to } = lastDays(30, now);
		assert.equal(to.toMillis(), now.toMillis());
		assert.equal(now.diff(from, "hours").hours, 720);
	});

	test("linkShare, noShowRate and median, and null with nothing to count", ({
		assert,
	}) => {
		assert.equal(linkShare({ linkInquiries: 12, deskProjects: 4 }), 0.75);
		assert.equal(linkShare({ linkInquiries: 0, deskProjects: 3 }), 0);
		assert.isNull(linkShare({ linkInquiries: 0, deskProjects: 0 }));
		assert.equal(noShowRate({ completed: 23, noShow: 2, noOutcome: 9 }), 0.08);
		assert.isNull(noShowRate({ completed: 0, noShow: 0, noOutcome: 4 }));
		assert.equal(median([5, 1, 3]), 3);
		assert.equal(median([4, 1, 3, 2]), 2.5);
		assert.equal(median([7]), 7);
		assert.isNull(median([]));
	});

	test("percentText rounds to whole percents; durationText reads hours, then days", ({
		assert,
	}) => {
		assert.equal(percentText(0.75), "75%");
		assert.equal(percentText(0.0833), "8%");
		assert.equal(percentText(1), "100%");
		assert.equal(durationText(0.4), "under an hour");
		assert.equal(durationText(1.2), "1 hour");
		assert.equal(durationText(18.4), "18 hours");
		assert.equal(durationText(47.6), "48 hours");
		assert.equal(durationText(48), "2 days");
		assert.equal(durationText(60), "2.5 days");
		assert.equal(durationText(73), "3 days");
	});

	test("combineFacts sums the counts and pools the durations", ({ assert }) => {
		assert.deepEqual(
			combineFacts([
				facts({
					linkInquiries: 2,
					deskProjects: 1,
					depositHours: [10],
					sessions: { completed: 3, noShow: 1, noOutcome: 0 },
				}),
				facts({
					linkInquiries: 1,
					depositHours: [20, 30],
					sessions: { completed: 1, noShow: 0, noOutcome: 2 },
				}),
			]),
			{
				linkInquiries: 3,
				deskProjects: 1,
				depositHours: [10, 20, 30],
				sessions: { completed: 4, noShow: 1, noOutcome: 2 },
			},
		);
		assert.deepEqual(combineFacts([]), noFacts());
	});
});

test.group("pilot metrics: words", () => {
	test("the card with data", ({ assert }) => {
		assert.deepEqual(pilotCard(busy, 30), {
			title: "Last 30 days",
			tiles: [
				{
					label: "Through the link",
					value: "75%",
					detail: "12 inquiries through the link, 4 bookings at the desk",
				},
				{
					label: "Inquiry to deposit",
					value: "2.7 days",
					detail: "Median of 8 deposits",
				},
				{
					label: "No-shows",
					value: "8%",
					detail: "2 of 25 finished sessions",
				},
			],
			note: "3 past sessions without an outcome aren't counted.",
		});
	});

	test("the card with nothing yet: dashes and why", ({ assert }) => {
		assert.deepEqual(pilotCard(noFacts(), 30), {
			title: "Last 30 days",
			tiles: [
				{
					label: "Through the link",
					value: "—",
					detail: "No inquiries or desk bookings yet.",
				},
				{
					label: "Inquiry to deposit",
					value: "—",
					detail: "No deposits verified from an inquiry yet.",
				},
				{
					label: "No-shows",
					value: "—",
					detail: "No finished sessions yet.",
				},
			],
			note: null,
		});
	});

	test("singulars", ({ assert }) => {
		const card = pilotCard(
			facts({
				linkInquiries: 1,
				deskProjects: 1,
				depositHours: [5],
				sessions: { completed: 0, noShow: 1, noOutcome: 1 },
			}),
			7,
		);
		assert.equal(card.title, "Last 7 days");
		assert.deepEqual(
			card.tiles.map(({ value, detail }) => [value, detail]),
			[
				["50%", "1 inquiry through the link, 1 booking at the desk"],
				["5 hours", "From 1 deposit"],
				["100%", "1 of 1 finished session"],
			],
		);
		assert.equal(card.note, "1 past session without an outcome isn't counted.");
	});

	test("pilotLines: the heading, one line per number, then the note", ({
		assert,
	}) => {
		assert.deepEqual(pilotLines("Black Needle (black-needle)", busy), [
			"Black Needle (black-needle)",
			"  Through the link: 75% (12 inquiries through the link, 4 bookings at the desk)",
			"  Inquiry to deposit: 2.7 days (Median of 8 deposits)",
			"  No-shows: 8% (2 of 25 finished sessions)",
			"  3 past sessions without an outcome aren't counted.",
		]);
		assert.lengthOf(pilotLines("Red Ink (red-ink)", noFacts()), 4);
	});
});
