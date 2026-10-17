import { WifiOff } from "lucide-react";
import { useOnline } from "~/hooks/use-online";

/** A slim notice while the connection is gone, so a failed tap isn't a mystery. */
export default function OfflineBar() {
	const online = useOnline();
	if (online) return null;

	return (
		<output className="flex items-center justify-center gap-2 bg-foreground px-4 py-1.5 text-sm text-background">
			<WifiOff className="size-4" aria-hidden="true" />
			You're offline. Changes won't save until you're back online.
		</output>
	);
}
