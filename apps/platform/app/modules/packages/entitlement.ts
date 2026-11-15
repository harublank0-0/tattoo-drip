import type { DateTime } from "luxon";
import {
	higherPackage,
	PACKAGES,
	type PackageKey,
} from "#modules/packages/packages";

/**
 * A studio's package state at one instant (docs/superpowers/specs/2026-11-15-studio-packages-design.md,
 * ruling 7): computed from its paid coverage, its pilot grants and its
 * trial, never stored, so verified payments alone decide paid access.
 * Every boundary is half-open: at its end instant a state is over.
 */

export const TRIAL_DAYS = 14;
export const GRACE_DAYS = 7;

export type EntitlementState = "trial" | "paid" | "grace" | "paused" | "pilot";

/** A paid period, in the active billing mode, with the package its plan sells. */
export type CoveragePeriod = {
	startsAt: DateTime;
	endsAt: DateTime;
	revokedAt: DateTime | null;
	package: PackageKey;
	bundleId: string;
};

export type PilotCoverage = {
	startsAt: DateTime;
	endsAt: DateTime;
	package: PackageKey;
	bundleId: string;
};

export type EntitlementInput = {
	at: DateTime;
	workspaceCreatedAt: DateTime;
	/** The package chosen at signup, with its default bundle. */
	trial: { package: PackageKey; bundleId: string };
	pilots: PilotCoverage[];
	periods: CoveragePeriod[];
};

export type Entitlement = {
	state: EntitlementState;
	package: PackageKey;
	bundleId: string;
	/** When this state ends; null when paused. */
	until: DateTime | null;
	artistLimit: number | null;
};

type Source = { package: PackageKey; bundleId: string; end: DateTime };

/** The item with the highest package; the first of equals. */
function highest<T extends { package: PackageKey }>(items: T[]): T {
	return items.reduce((best, item) =>
		item.package !== best.package &&
		higherPackage(best.package, item.package) === item.package
			? item
			: best,
	);
}

function entitlement(
	state: EntitlementState,
	source: { package: PackageKey; bundleId: string },
	until: DateTime | null,
): Entitlement {
	return {
		state,
		package: source.package,
		bundleId: source.bundleId,
		until,
		artistLimit: PACKAGES[source.package].artistLimit,
	};
}

/** The studio's state at `input.at`; the first rule that matches wins. */
export function resolveEntitlement(input: EntitlementInput): Entitlement {
	const { at } = input;
	// A revoked period counts only until its revocation; one revoked before
	// it began counts for nothing.
	const periods = input.periods
		.map((period) => ({
			...period,
			end:
				period.revokedAt && period.revokedAt < period.endsAt
					? period.revokedAt
					: period.endsAt,
		}))
		.filter((period) => period.end > period.startsAt)
		.sort((a, b) => a.startsAt.toMillis() - b.startsAt.toMillis());

	const covering = periods.filter(
		(period) => period.startsAt <= at && at < period.end,
	);
	let paid: Source | null = null;
	if (covering.length > 0) {
		// Until the end of the continuous run of coverage from `at`.
		let until = covering.reduce(
			(latest, period) => (period.end > latest ? period.end : latest),
			covering[0].end,
		);
		for (const period of periods) {
			if (period.startsAt <= until && period.end > until) until = period.end;
		}
		const top = highest(covering);
		paid = { package: top.package, bundleId: top.bundleId, end: until };
	}

	const running = input.pilots.filter(
		(grant) => grant.startsAt <= at && at < grant.endsAt,
	);
	const pilot = running.length > 0 ? highest(running) : null;

	if (
		pilot &&
		(!paid || higherPackage(pilot.package, paid.package) === pilot.package)
	) {
		return entitlement("pilot", pilot, pilot.endsAt);
	}
	if (paid) return entitlement("paid", paid, paid.end);

	// Grace: only after coverage that ran out, never after a revocation.
	const ended = periods.filter((period) => period.end <= at);
	if (ended.length > 0) {
		const lastEnd = ended.reduce(
			(latest, period) => (period.end > latest ? period.end : latest),
			ended[0].end,
		);
		const lapsed = ended.filter(
			(period) =>
				period.end.toMillis() === lastEnd.toMillis() &&
				// Revoked by `at` (a refund or chargeback, even one recorded after
				// the period ended) is no ordinary lapse.
				(!period.revokedAt || period.revokedAt > at),
		);
		const graceEnd = lastEnd.plus({ days: GRACE_DAYS });
		if (lapsed.length > 0 && at < graceEnd) {
			return entitlement("grace", highest(lapsed), graceEnd);
		}
	}

	// "Never paid" means no coverage that began by `at`: a period that counts
	// for nothing or hasn't started yet doesn't end the trial.
	const begun = periods.filter((period) => period.startsAt <= at);
	const trialEnd = input.workspaceCreatedAt.plus({ days: TRIAL_DAYS });
	if (begun.length === 0 && at < trialEnd) {
		return entitlement("trial", input.trial, trialEnd);
	}

	// Paused, with the package and bundle of whatever ended last. The trial
	// ended at the first payment, if that came first.
	const firstPaid = begun[0]?.startsAt;
	const past: Source[] = [
		...begun,
		...input.pilots
			.filter((grant) => grant.endsAt <= at)
			.map((grant) => ({ ...grant, end: grant.endsAt })),
		{
			...input.trial,
			end: firstPaid && firstPaid < trialEnd ? firstPaid : trialEnd,
		},
	];
	const latestEnd = past.reduce(
		(latest, source) => (source.end > latest ? source.end : latest),
		past[0].end,
	);
	const last = highest(
		past.filter((source) => source.end.toMillis() === latestEnd.toMillis()),
	);
	return entitlement("paused", last, null);
}

/** The one-line status the Billing pages show, with `day` formatting dates. */
export function entitlementText(
	value: Entitlement,
	day: (at: DateTime) => string,
): string {
	const name = PACKAGES[value.package].name;
	const until = value.until ? ` until ${day(value.until)}` : "";
	switch (value.state) {
		case "trial":
			return `${name} trial${until}`;
		case "paid":
			return `${name}, paid${until}`;
		case "grace":
			return `${name}, payment overdue: grace${until}`;
		case "pilot":
			return `${name}, pilot${until}`;
		case "paused":
			// Observe mode (phase 1): nothing is paused yet, so say only what is
			// true. The paused wording comes with enforcement (phase 3).
			return "No paid package yet";
	}
}
