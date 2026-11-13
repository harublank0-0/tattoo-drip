import { Badge } from "~/components/ui/badge";
import type { ExpiryStatus } from "./lots";

/** "Expired" or "Expires soon" for a lot, or an item with such a lot. */
export function ExpiryBadge({
	expiry,
	item = false,
}: {
	expiry: ExpiryStatus;
	/** Words for an item (its stock) rather than one lot. */
	item?: boolean;
}) {
	if (expiry === "expired") {
		return (
			<Badge variant="destructive">{item ? "Expired stock" : "Expired"}</Badge>
		);
	}
	if (expiry === "soon") {
		return (
			<Badge variant="outline">
				{item ? "Stock expiring soon" : "Expires soon"}
			</Badge>
		);
	}
	return null;
}
