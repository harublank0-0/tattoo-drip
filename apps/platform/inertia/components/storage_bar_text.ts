/** The shared `storage` prop's shape, as the bar reads it. */
type Storage = {
	limitText: string | null;
	percent: number | null;
	full: boolean;
	enforced: boolean;
};

/** From this share of the allowance the dashboard warns (the storage meter). */
const WARN_AT_PERCENT = 80;

/**
 * The dashboard's storage warning (the storage meter, What people see):
 * shown to every member from 80% of the allowance, once STORAGE_ENFORCEMENT
 * is on (before that, Billing shows the state). Owners also get a link to
 * Billing. Null when there is nothing to say.
 */
export function storageBarText(
	storage: Storage | null | undefined,
	role: string | undefined,
): { text: string; billing: boolean } | null {
	if (!storage?.enforced || storage.percent === null) return null;
	if (!storage.full && storage.percent < WARN_AT_PERCENT) return null;
	return {
		text: storage.full
			? "Your studio's storage is full: new uploads are paused until there's room. Existing files, bookings and deposits keep working."
			: `Your studio has used ${storage.percent}% of its ${storage.limitText} storage.`,
		billing: role === "owner",
	};
}
