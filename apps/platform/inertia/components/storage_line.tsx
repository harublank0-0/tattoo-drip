import { usePage } from "@inertiajs/react";

/**
 * The studio's storage on its upload pages (the storage meter): "Storage:
 * 1.2 GB of 5 GB used", from the shared `storage` prop. Nothing when the
 * studio's package isn't metered. Before limits are switched on it says so.
 */
export default function StorageLine() {
	const { storage } = usePage().props;
	if (!storage?.limitText) return null;
	return (
		<p className="text-sm text-muted-foreground">
			Storage: {storage.usedText} of {storage.limitText} used
			{storage.enforced ? "" : " (limits aren't applied yet)"}
		</p>
	);
}
