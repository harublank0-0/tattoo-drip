import { Link, usePage } from "@inertiajs/react";
import { urlFor } from "~/client";
import { storageBarText } from "~/components/storage_bar_text";

/**
 * Under the top bar when the studio's storage is nearly full or full (the
 * storage meter), for every member once enforcement is on; owners get a
 * link to Billing, where its use is broken down.
 */
export default function StorageBar() {
	const { storage, tenant } = usePage().props;
	const bar = storageBarText(storage, tenant?.role);
	if (!bar || !tenant) return null;

	return (
		<section
			aria-label="Studio storage"
			className="flex flex-wrap items-center justify-center gap-x-3 border-b bg-muted px-4 py-2 text-sm"
		>
			<p>{bar.text}</p>
			{bar.billing && (
				<Link
					href={urlFor("tenant.settings.billing", { tenant: tenant.slug })}
					className="inline-flex min-h-11 items-center underline underline-offset-4"
				>
					See storage
				</Link>
			)}
		</section>
	);
}
