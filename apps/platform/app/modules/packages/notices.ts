import { type DateTime, Duration } from "luxon";
import { type Entitlement, GRACE_DAYS } from "#modules/packages/entitlement";

/**
 * Package notices (docs/superpowers/specs/2026-11-15-studio-packages-design.md,
 * Notices): 3 days and 1 day before the trial ends; 3 days before paid
 * coverage ends (`until` is already the end of continuous coverage, so a
 * period a later one continues gets none); when grace starts and 1 day
 * before it ends; a pilot's 3 days before its transition date. Sent only
 * once enforcement is on; in observe mode PackageNoticeJob logs them.
 */
export type PackageNotice =
	| "trial_ends_in_3_days"
	| "trial_ends_in_1_day"
	| "paid_ends_in_3_days"
	| "grace_started"
	| "grace_ends_in_1_day"
	| "pilot_ends_in_3_days";

/** The daily sweep's interval: each moment falls in exactly one sweep. */
export const NOTICE_WINDOW = Duration.fromObject({ hours: 24 });

/**
 * The sweep's nominal moment: the latest 03:17 UTC at or before `now`
 * (SweepPackageNoticesJob's cron). Every job of one sweep judges at it, so
 * a late, retried or slow run still tiles the windows with the days
 * before and after; only a day the worker misses entirely loses its
 * notices.
 */
export function sweepMoment(now: DateTime): DateTime {
	const today = now
		.toUTC()
		.set({ hour: 3, minute: 17, second: 0, millisecond: 0 });
	return today <= now ? today : today.minus({ days: 1 });
}

/**
 * The notice whose moment falls in `(at - window, at]`, or null. The
 * window is the sweep's interval, so consecutive sweeps give each notice
 * once.
 */
export function dueNotice(
	entitlement: Entitlement,
	at: DateTime,
	window: Duration = NOTICE_WINDOW,
): PackageNotice | null {
	const { until } = entitlement;
	if (!until) return null;
	const moments: [PackageNotice, DateTime][] =
		entitlement.state === "trial"
			? [
					["trial_ends_in_3_days", until.minus({ days: 3 })],
					["trial_ends_in_1_day", until.minus({ days: 1 })],
				]
			: entitlement.state === "paid"
				? [["paid_ends_in_3_days", until.minus({ days: 3 })]]
				: entitlement.state === "grace"
					? [
							["grace_started", until.minus({ days: GRACE_DAYS })],
							["grace_ends_in_1_day", until.minus({ days: 1 })],
						]
					: entitlement.state === "pilot"
						? [["pilot_ends_in_3_days", until.minus({ days: 3 })]]
						: [];
	const from = at.minus(window);
	const due = moments.find(([, moment]) => moment > from && moment <= at);
	return due ? due[0] : null;
}
