import { router, usePage } from "@inertiajs/react";
import { useEffect } from "react";
import { toast } from "sonner";
import { Toaster } from "~/components/ui/sonner";

/**
 * Shows the session's flash `success` / `error` message as a toast, and
 * dismisses it when the next visit starts.
 */
export default function FlashToasts() {
	const { flash } = usePage();

	useEffect(() => {
		return router.on("start", () => toast.dismiss("flash"));
	}, []);

	useEffect(() => {
		if (flash.error) toast.error(flash.error, { id: "flash" });
		if (flash.success) toast.success(flash.success, { id: "flash" });
	}, [flash]);

	return <Toaster position="top-center" />;
}
