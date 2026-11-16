import { test } from "@japa/runner";
import { DateTime } from "luxon";
import {
	type Entitlement,
	resolveEntitlement,
} from "#modules/packages/entitlement";
import { dueNotice } from "#modules/packages/notices";

/**
 * Package notices (studio packages, phase 3; spec, Notices): each falls in
 * exactly one daily sweep, at 03:17 UTC.
 */

const at = (iso: string) => DateTime.fromISO(iso, { zone: "utc" });

const entitlement = (
	state: Entitlement["state"],
	until: string | null,
): Entitlement => ({
	state,
	package: "studio",
	bundleId: "b",
	until: until ? at(until) : null,
	artistLimit: null,
});

/** The notices daily sweeps at 03:17 UTC give from `from` to `to`, by day. */
function sweeps(value: Entitlement, from: string, to: string) {
	const found: [string, string][] = [];
	for (let day = at(from); day <= at(to); day = day.plus({ days: 1 })) {
		const sweep = day.set({ hour: 3, minute: 17 });
		const notice = dueNotice(value, sweep);
		if (notice) found.push([sweep.toISODate() as string, notice]);
	}
	return found;
}

test.group("Packages: notices", () => {
	test("a trial gets its 3-day and 1-day notices once each across daily sweeps", ({
		assert,
	}) => {
		assert.deepEqual(
			sweeps(
				entitlement("trial", "2026-12-01T00:00:00Z"),
				"2026-11-25",
				"2026-12-01",
			),
			[
				["2026-11-28", "trial_ends_in_3_days"],
				["2026-11-30", "trial_ends_in_1_day"],
			],
		);
	});

	test("paid coverage gets one notice 3 days before it ends", ({ assert }) => {
		assert.deepEqual(
			sweeps(
				entitlement("paid", "2026-12-10T12:00:00Z"),
				"2026-12-01",
				"2026-12-10",
			),
			[["2026-12-08", "paid_ends_in_3_days"]],
		);
	});

	test("paid coverage continued by a later period gets no notice until the later end", ({
		assert,
	}) => {
		const period = (from: string, to: string) => ({
			startsAt: at(from),
			endsAt: at(to),
			revokedAt: null,
			package: "studio" as const,
			bundleId: "b",
		});
		const resolved = (when: string) =>
			resolveEntitlement({
				at: at(when),
				workspaceCreatedAt: at("2025-01-01T00:00:00Z"),
				trial: { package: "studio", bundleId: "b" },
				pilots: [],
				periods: [
					period("2026-11-01T00:00:00Z", "2026-12-01T00:00:00Z"),
					period("2026-12-01T00:00:00Z", "2027-01-01T00:00:00Z"),
				],
			});
		// Three days before the first period ends, coverage goes on.
		assert.isNull(
			dueNotice(resolved("2026-11-28T03:17:00Z"), at("2026-11-28T03:17:00Z")),
		);
		assert.equal(
			dueNotice(resolved("2026-12-29T03:17:00Z"), at("2026-12-29T03:17:00Z")),
			"paid_ends_in_3_days",
		);
	});

	test("grace gets a notice when it starts and 1 day before it ends", ({
		assert,
	}) => {
		assert.deepEqual(
			sweeps(
				entitlement("grace", "2026-12-08T00:00:00Z"),
				"2026-12-01",
				"2026-12-08",
			),
			[
				["2026-12-01", "grace_started"],
				["2026-12-07", "grace_ends_in_1_day"],
			],
		);
	});

	test("a pilot gets one notice 3 days before its transition date; a paused studio gets none", ({
		assert,
	}) => {
		assert.deepEqual(
			sweeps(
				entitlement("pilot", "2027-03-31T00:00:00Z"),
				"2027-03-20",
				"2027-03-31",
			),
			[["2027-03-28", "pilot_ends_in_3_days"]],
		);
		assert.deepEqual(
			sweeps(entitlement("paused", null), "2026-12-01", "2026-12-31"),
			[],
		);
	});
});
