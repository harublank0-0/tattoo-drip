import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void) {
	window.addEventListener("online", onChange);
	window.addEventListener("offline", onChange);
	return () => {
		window.removeEventListener("online", onChange);
		window.removeEventListener("offline", onChange);
	};
}

/** Whether the browser has a connection, from its online/offline events. */
export function useOnline(): boolean {
	return useSyncExternalStore(
		subscribe,
		() => navigator.onLine,
		() => true,
	);
}
