import type { ReactNode } from "react";

/**
 * The warning for a link that points at this computer (STOREFRONT_URL
 * unset in development): no client could open it. One text for the deposit
 * panel and the studio link card; `children` says which link.
 */
export default function DevHostWarning({ children }: { children: ReactNode }) {
	return (
		<p className="rounded-md border border-destructive p-3 text-sm">
			<strong>Warning:</strong> {children} Set STOREFRONT_URL to your studio
			pages' address (for example https://{"{tenant}"}.example.com) and restart.
		</p>
	);
}
