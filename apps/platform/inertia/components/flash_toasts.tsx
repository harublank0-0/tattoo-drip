import { router, usePage } from "@inertiajs/react";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { Toaster } from "~/components/ui/sonner";
import { isQuietVisit } from "~/components/visits";

/**
 * Shows the session's flash `success` / `error` message as a toast, and
 * dismisses it when the next visit starts (not a quiet one: a poll). Every message gets a toast of its
 * own (a fresh id): the visit that brings a message also dismisses the
 * previous toast, and Sonner keeps a dismissed id deleted, so a message that
 * reused the id of a toast still fading out was never shown (a failed
 * removal's error came up empty right after an upload's "saved").
 */
export default function FlashToasts() {
	const { flash } = usePage();
	const shown = useRef<string | number | null>(null);

	useEffect(() => {
		return router.on("start", (event) => {
			// A quiet visit (the portfolio asking again while a video processes)
			// leaves the message where it is.
			if (isQuietVisit(event.detail.visit)) return;
			if (shown.current !== null) toast.dismiss(shown.current);
			shown.current = null;
		});
	}, []);

	useEffect(() => {
		if (flash.error) shown.current = toast.error(flash.error);
		if (flash.success) shown.current = toast.success(flash.success);
	}, [flash]);

	return <Toaster position="top-center" />;
}
