import { test } from "@japa/runner";
import { DateTime } from "luxon";
import {
	expiresAtFor,
	formatDay,
	formatHours,
	formatMoney,
	isExpired,
	priceText,
	quoteMessage,
	quoteTotal,
	todayIn,
	validUntil,
} from "#modules/projects/quotes";

const KTM = "Asia/Kathmandu";

const fixed = {
	kind: "fixed" as const,
	fixedPrice: 1_500_000,
	hourlyRate: null,
	estimatedMinutes: null,
};
const hourly = {
	kind: "hourly" as const,
	fixedPrice: null,
	hourlyRate: 300_000,
	estimatedMinutes: 300,
};

test.group("quoteTotal", () => {
	test("is the fixed price, or the rate for the estimated minutes", ({
		assert,
	}) => {
		assert.equal(quoteTotal(fixed), 1_500_000n);
		assert.equal(quoteTotal(hourly), 1_500_000n);
		assert.equal(quoteTotal({ ...hourly, estimatedMinutes: 270 }), 1_350_000n);
	});

	test("rounds half away from zero, like the database check", ({ assert }) => {
		// 1 paisa an hour for 30 minutes is half a paisa: rounds up.
		assert.equal(
			quoteTotal({ ...hourly, hourlyRate: 1, estimatedMinutes: 30 }),
			1n,
		);
		assert.equal(
			quoteTotal({ ...hourly, hourlyRate: 1, estimatedMinutes: 29 }),
			0n,
		);
	});

	test("stays exact past 2^53", ({ assert }) => {
		const max = 2_147_483_647;
		// 2147483647² = 4611686014132420609; / 60 = 76861433568873676.816…
		assert.equal(
			quoteTotal({ ...hourly, hourlyRate: max, estimatedMinutes: max }),
			76_861_433_568_873_677n,
		);
	});
});

test.group("formatMoney, formatHours and priceText", () => {
	test("formats paisa as rupees with South Asian grouping", ({ assert }) => {
		assert.equal(formatMoney(1_500_000), "NPR 15,000");
		assert.equal(formatMoney(15_000_000n), "NPR 1,50,000");
		assert.equal(formatMoney(123_450), "NPR 1,234.50");
		assert.equal(formatMoney(5), "NPR 0.05");
		assert.equal(formatMoney(0), "NPR 0");
	});

	test("formats minutes as hours without trailing zeros", ({ assert }) => {
		assert.equal(formatHours(300), "5");
		assert.equal(formatHours(270), "4.5");
		assert.equal(formatHours(285), "4.75");
		assert.equal(formatHours(15), "0.25");
	});

	test("prints the price line", ({ assert }) => {
		assert.equal(priceText(fixed), "NPR 15,000");
		assert.equal(priceText(hourly), "NPR 3,000/hour × about 5 h");
	});
});

test.group("expiry dates", () => {
	test("a quote valid through a day expires at the start of the next one there", ({
		assert,
	}) => {
		const expiresAt = expiresAtFor("2026-10-28", KTM);
		// Kathmandu is UTC+5:45.
		assert.equal(expiresAt.toUTC().toISO(), "2026-10-28T18:15:00.000Z");
		assert.equal(validUntil(expiresAt, KTM), "2026-10-28");
	});

	test("follows the timezone across a daylight-saving change", ({ assert }) => {
		const zone = "America/New_York";
		// Clocks go back on 1 Nov 2026; 2 Nov starts at UTC-5.
		const expiresAt = expiresAtFor("2026-11-01", zone);
		assert.equal(expiresAt.toUTC().toISO(), "2026-11-02T05:00:00.000Z");
		assert.equal(validUntil(expiresAt, zone), "2026-11-01");
	});

	test("today is the studio's date, not the server's", ({ assert }) => {
		const now = DateTime.fromISO("2026-10-14T20:00:00Z");
		assert.equal(todayIn(KTM, now), "2026-10-15");
		assert.equal(todayIn("UTC", now), "2026-10-14");
	});

	test("a quote is expired from its expires_at on", ({ assert }) => {
		const expiresAt = DateTime.fromISO("2026-10-28T18:15:00Z");
		assert.isTrue(isExpired({ expiresAt }, expiresAt));
		assert.isFalse(
			isExpired({ expiresAt }, expiresAt.minus({ milliseconds: 1 })),
		);
	});

	test("formats a day for people", ({ assert }) => {
		assert.equal(formatDay("2026-10-28"), "28 Oct 2026");
		assert.equal(formatDay("2026-01-05"), "5 Jan 2026");
	});
});

test.group("quoteMessage", () => {
	const expiresAt = expiresAtFor("2026-10-28", KTM);

	test("writes a fixed quote with its deposit", ({ assert }) => {
		assert.equal(
			quoteMessage({
				clientName: "Sita Rai",
				studioName: "Ink House",
				quote: { ...fixed, depositAmount: 300_000, expiresAt },
				timezone: KTM,
			}),
			"Hi Sita, here is your quote from Ink House: NPR 15,000. Deposit: NPR 3,000. Valid until 28 Oct 2026. Reply here to confirm.",
		);
	});

	test("writes an hourly quote with no deposit", ({ assert }) => {
		assert.equal(
			quoteMessage({
				clientName: "Sita Rai",
				studioName: "Ink House",
				quote: { ...hourly, depositAmount: 0, expiresAt },
				timezone: KTM,
			}),
			"Hi Sita, here is your quote from Ink House: NPR 3,000/hour × about 5 h ≈ NPR 15,000. No deposit needed. Valid until 28 Oct 2026. Reply here to confirm.",
		);
	});

	test("greets a client with no name plainly", ({ assert }) => {
		const text = quoteMessage({
			clientName: "  ",
			studioName: "Ink House",
			quote: { ...fixed, depositAmount: 0, expiresAt },
			timezone: KTM,
		});
		assert.isTrue(text.startsWith("Hi, here is your quote"));
	});
});
