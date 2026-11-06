import { useCallback, useSyncExternalStore } from "react";

const KEY = "td.sidebar";
const EVENT = "td:sidebar";

// Where the choice lives while storage is refused (a private window).
let unstored = false;

function read(): boolean {
	try {
		return window.localStorage.getItem(KEY) === "collapsed";
	} catch {
		return unstored;
	}
}

function subscribe(onChange: () => void) {
	window.addEventListener(EVENT, onChange);
	window.addEventListener("storage", onChange);
	return () => {
		window.removeEventListener(EVENT, onChange);
		window.removeEventListener("storage", onChange);
	};
}

/**
 * Whether the desktop sidebar is collapsed to its icon rail, and a setter.
 * A per-browser convenience (localStorage), read synchronously on the first
 * render, so the page never draws the wrong width first; private windows and
 * blocked storage fall back to the expanded sidebar.
 */
export function useSidebarCollapsed() {
	const collapsed = useSyncExternalStore(subscribe, read, () => false);
	const setCollapsed = useCallback((next: boolean) => {
		unstored = next;
		try {
			if (next) window.localStorage.setItem(KEY, "collapsed");
			else window.localStorage.removeItem(KEY);
		} catch {
			// Storage refused: the choice lasts until the page reloads.
		}
		window.dispatchEvent(new Event(EVENT));
	}, []);
	return [collapsed, setCollapsed] as const;
}
