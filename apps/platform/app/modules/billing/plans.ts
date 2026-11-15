import type { IntervalUnit } from "#modules/billing/models/billing_plan";
import type { PackageKey } from "#modules/packages/packages";

/**
 * TattooDrip's paid plans for studios, in paisa (docs/payments-paybridgenp.md).
 * The catalogue lives here; `node ace billing:sync-plans` creates each one at
 * PayBridgeNP once per mode and stores its id in `billing_plans`.
 * PayBridgeNP plans can't change amount or interval once created, so a new
 * price is a new code. The prices are placeholders until TattooDrip sets
 * its launch prices.
 */
export type CataloguePlan = {
	code: string;
	name: string;
	/** Integer paisa. */
	amount: number;
	intervalUnit: IntervalUnit;
	intervalCount: number;
	trialDays: number;
	/** The package the plan sells. */
	package: PackageKey;
	/** The allowance bundle it gives (`allowance_bundles.key`). */
	bundleKey: string;
};

export const PLAN_CATALOGUE: readonly CataloguePlan[] = [
	{
		code: "studio-monthly",
		name: "TattooDrip Studio, monthly",
		amount: 250_000, // NPR 2,500
		intervalUnit: "month",
		intervalCount: 1,
		trialDays: 0,
		package: "studio",
		bundleKey: "studio-v1",
	},
	{
		code: "studio-yearly",
		name: "TattooDrip Studio, yearly",
		amount: 2_500_000, // NPR 25,000
		intervalUnit: "year",
		intervalCount: 1,
		trialDays: 0,
		package: "studio",
		bundleKey: "studio-v1",
	},
];

/** "every month", "every 3 months", "every year". */
export function intervalText(unit: IntervalUnit, count: number): string {
	return count === 1 ? `every ${unit}` : `every ${count} ${unit}s`;
}
