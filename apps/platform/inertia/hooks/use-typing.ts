import { useSyncExternalStore } from "react";
import { opensKeyboard } from "~/components/shell/typing";

function subscribe(onChange: () => void) {
	document.addEventListener("focusin", onChange);
	document.addEventListener("focusout", onChange);
	return () => {
		document.removeEventListener("focusin", onChange);
		document.removeEventListener("focusout", onChange);
	};
}

/** Whether the focused element takes typing (`opensKeyboard`), from focus events. */
export function useTyping(): boolean {
	return useSyncExternalStore(
		subscribe,
		() => opensKeyboard(document.activeElement as HTMLInputElement | null),
		() => false,
	);
}
