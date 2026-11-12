import { test } from "@japa/runner";
import {
	EXPIRY_WARNING_DAYS,
	expiryHorizon,
	expiryStatus,
	isCalendarDate,
} from "#modules/inventory/stock";

test.group("Inventory lot expiry", () => {
	test("a lot is in date through its expiry day and flagged within the window", ({
		assert,
	}) => {
		const today = "2026-11-12";
		assert.equal(EXPIRY_WARNING_DAYS, 30);
		assert.equal(expiryHorizon(today), "2026-12-12");
		assert.isNull(expiryStatus(null, today));
		assert.equal(expiryStatus("2026-11-11", today), "expired");
		assert.equal(expiryStatus("2026-11-12", today), "soon");
		assert.equal(expiryStatus("2026-12-12", today), "soon");
		assert.isNull(expiryStatus("2026-12-13", today));
	});

	test("the window crosses months and leap days by calendar date", ({
		assert,
	}) => {
		assert.equal(expiryHorizon("2028-02-15"), "2028-03-16");
		assert.equal(expiryHorizon("2026-12-20"), "2027-01-19");
	});

	test("expiry dates must be real calendar dates in range", ({ assert }) => {
		assert.isTrue(isCalendarDate("2028-02-29"));
		assert.isFalse(isCalendarDate("2027-02-29"));
		assert.isFalse(isCalendarDate("2026-13-01"));
		assert.isFalse(isCalendarDate("1999-12-31"));
		assert.isFalse(isCalendarDate("2101-01-01"));
		assert.isFalse(isCalendarDate("2026-1-01"));
	});
});
