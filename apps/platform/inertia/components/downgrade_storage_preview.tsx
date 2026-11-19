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
	enforced,
}: {
	preview: DowngradePreview;
	/** STORAGE_ENFORCEMENT is on: a full studio's uploads are refused. */
	enforced: boolean;
}) {
	return (
		<p className="text-sm text-muted-foreground">
			{downgradeStorageText(preview, enforced)}
		</p>
	);
}
