import { test } from "@japa/runner";
import { DateTime, Settings } from "luxon";
import { localDateTime, sessionTimeText } from "#modules/scheduling/times";

const KTM = "Asia/Kathmandu";
const NY = "America/New_York";

test.group("localDateTime", () => {
	test("reads a local date and time in the studio's timezone", ({ assert }) => {
		assert.equal(
			localDateTime("2026-10-18", "14:00", KTM)?.toUTC().toISO(),
			"2026-10-18T08:15:00.000Z",
		);
	});

	test("refuses a time the clocks skip and a date that doesn't exist", ({
		assert,
	}) => {
		// 14 March 2027: New York's clocks jump from 02:00 to 03:00.
		assert.isNull(localDateTime("2027-03-14", "02:30", NY));
		assert.isNull(localDateTime("2026-02-30", "10:00", KTM));
	});

	// Luxon guesses a repeated or skipped hour from the zone's offset at
	// `Settings.now`, so these run under a winter and a summer clock.
	for (const [season, now] of [
		["winter", "2027-01-15T12:00:00Z"],
		["summer", "2026-07-15T12:00:00Z"],
	] as const) {
		test(`a time the clocks pass twice is the first one (${season} clock)`, ({
			assert,
			cleanup,
		}) => {
			const realNow = Settings.now;
			cleanup(() => {
				Settings.now = realNow;
			});
			const frozen = new Date(now).getTime();
			Settings.now = () => frozen;
			// 1 November 2026: New York's clocks go back from 02:00 to 01:00.
			assert.equal(
				localDateTime("2026-11-01", "01:30", NY)?.toUTC().toISO(),
				"2026-11-01T05:30:00.000Z",
			);
			// The hour after the fold is normal time, and the gap stays refused.
			assert.equal(
				localDateTime("2026-11-01", "02:30", NY)?.toUTC().toISO(),
				"2026-11-01T07:30:00.000Z",
			);
			assert.isNull(localDateTime("2027-03-14", "02:30", NY));
		});
	}
});

test.group("sessionTimeText", () => {
	test("a session within one day", ({ assert }) => {
		const start = DateTime.fromISO("2026-10-18T08:15:00Z");
		assert.equal(
			sessionTimeText(start, start.plus({ hours: 3 }), KTM),
			"Sun 18 Oct 2026, 14:00–17:00",
		);
	});

	test("a session across midnight names both days", ({ assert }) => {
		// 22:30 in Kathmandu.
		const start = DateTime.fromISO("2026-10-18T16:45:00Z");
		assert.equal(
			sessionTimeText(start, start.plus({ hours: 3 }), KTM),
			"Sun 18 Oct 2026, 22:30 – Mon 19 Oct 2026, 01:30",
		);
	});
});
