import { usePage } from "@inertiajs/react";
import { useCallback, useSyncExternalStore } from "react";
import {
	preferenceFromCookie,
	resolveTheme,
	type Theme,
	type ThemePreference,
	themeCookie,
} from "~/components/shell/theme";

export type { Theme, ThemePreference };

const DARK_QUERY = "(prefers-color-scheme: dark)";

function readTheme(): Theme {
	return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function readPreference(): ThemePreference {
	return preferenceFromCookie(document.cookie);
}

function apply(preference: ThemePreference) {
	document.documentElement.dataset.theme = resolveTheme(
		preference,
		window.matchMedia(DARK_QUERY).matches,
	);
}

// The layout's inline script follows the device only on a page loaded
// without the cookie; a System picked later follows it from here (once).
let followingDevice = false;
function followDevice() {
	if (followingDevice) return;
	followingDevice = true;
	window.matchMedia(DARK_QUERY).addEventListener("change", () => {
		if (readPreference() === "system") apply("system");
	});
}

function subscribe(onChange: () => void) {
	// Every change of preference also writes data-theme (even to the same
	// value), so this one observer covers both snapshots.
	const observer = new MutationObserver(onChange);
	observer.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ["data-theme"],
	});
	return () => observer.disconnect();
}

/**
 * The theme on screen (`theme`, light or dark), the person's choice
 * (`preference`, which can be "system") and a setter for that choice. The
 * theme lives in `data-theme` on <html>, rendered from the `app_theme`
 * cookie by inertia_layout.edge, so every component using this hook stays in
 * sync and the page never flashes. `setTheme` is the light/dark shortcut the
 * sign-in pages' toggle uses.
 */
export function useTheme() {
	const { props } = usePage();
	const theme = useSyncExternalStore(
		subscribe,
		readTheme,
		() => props.preferences?.theme ?? "light",
	);
	const preference = useSyncExternalStore(
		subscribe,
		readPreference,
		() => "system" as ThemePreference,
	);

	const setPreference = useCallback((next: ThemePreference) => {
		// biome-ignore lint/suspicious/noDocumentCookie: the Cookie Store API isn't in every browser yet, and this plain cookie only tells the server which theme to render.
		document.cookie = themeCookie(next);
		if (next === "system") followDevice();
		apply(next);
	}, []);

	return { theme, preference, setPreference, setTheme: setPreference };
}
