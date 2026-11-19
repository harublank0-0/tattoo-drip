/** A Studio studio's storage as it would be on Solo (StorageMeterService.downgradePreview). */
export type DowngradePreview = {
	usedText: string;
	soloText: string;
	/** How far over Solo's allowance; null when it fits. */
	overText: string | null;
};

/**
 * The downgrade preview's sentence (the storage meter, step 4): whether the
 * studio's files fit Solo's allowance, and if not, that nothing is deleted
 * and new uploads pause until there's room.
 */
export function downgradeStorageText(preview: DowngradePreview): string {
	const on = `On Solo (${preview.soloText}), your ${preview.usedText}`;
	return preview.overText === null
		? `${on} fits.`
		: `${on} is ${preview.overText} over. Nothing is deleted: your files stay, and new uploads pause until there's room.`;
}
