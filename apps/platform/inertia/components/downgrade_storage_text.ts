/** A Studio studio's storage as it would be on Solo (StorageMeterService.downgradePreview). */
export type DowngradePreview = {
	soloText: string;
	/** How far over Solo's allowance; null when it fits. */
	overText: string | null;
};

/**
 * The downgrade preview's sentence (the storage meter, step 4): whether the
 * studio's files fit Solo's allowance, and if not, how far over, that
 * nothing is deleted, and that new uploads pause until there's room (once
 * storage limits apply, before `enforced`).
 */
export function downgradeStorageText(
	preview: DowngradePreview,
	enforced: boolean,
): string {
	if (preview.overText === null) {
		return `On Solo, everything you keep fits in its ${preview.soloText}.`;
	}
	const pause = enforced
		? "new uploads pause until there's room"
		: "once storage limits apply, new uploads pause until there's room";
	return `On Solo, your files would be ${preview.overText} over its ${preview.soloText}. Nothing is deleted: your files stay, and ${pause}.`;
}
