import type { ProjectStatus } from "#modules/projects/models/tattoo_project";

/** The statuses a quote's expiry can cancel. */
export const EXPIRING_STATUSES: readonly ProjectStatus[] = [
	"quoted",
	"on_hold",
	"deposit_pending",
];

/**
 * Whether the expiry of a quote cancels a project in `status`, from the
 * money facts alone (TAT-107): the one rule `ProjectService.expiryCancels`
 * (the sweep) and `waitingOf` (Today) share, so Today never shows or hides
 * a project the sweep treats differently. Only `quoted`, `on_hold` and
 * `deposit_pending` projects can be cancelled. A `deposit_pending` project
 * is cancelled unless its deposit is covered (a zero deposit is covered by
 * definition: booking waits on a session only). A `quoted` or `on_hold`
 * project is cancelled unless a non-zero deposit was paid (it can hold a
 * payment when staff revised the quote after the client paid); a zero
 * deposit is "settled" by definition, so it spares a quote nobody accepted
 * nothing. The sweep also spares a project whose deposit screenshot waits
 * or whose deposit was decided after the expiry (`DepositService.expirySpared`,
 * TAT-66): facts only the sweep reads live.
 */
export function expiryCancels({
	status,
	depositAmount,
	depositSettled,
}: {
	status: ProjectStatus;
	/** The current quote's deposit, in paisa. */
	depositAmount: number;
	/** The deposit is covered (a zero deposit is). */
	depositSettled: boolean;
}): boolean {
	if (!EXPIRING_STATUSES.includes(status)) return false;
	if (status === "deposit_pending") return !depositSettled;
	return depositAmount === 0 || !depositSettled;
}
