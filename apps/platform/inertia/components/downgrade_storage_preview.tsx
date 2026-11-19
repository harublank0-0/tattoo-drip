import {
	type DowngradePreview,
	downgradeStorageText,
} from "~/components/downgrade_storage_text";

/**
 * A Studio studio's storage on Solo (the storage meter, step 4): on Billing
 * now, and on the downgrade screen before an owner confirms (packages,
 * phase 4).
 */
export default function DowngradeStoragePreview({
	preview,
}: {
	preview: DowngradePreview;
}) {
	return (
		<p className="text-sm text-muted-foreground">
			{downgradeStorageText(preview)}
		</p>
	);
}
