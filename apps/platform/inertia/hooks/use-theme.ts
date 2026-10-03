import { usePage } from "@inertiajs/react";
import { useCallback, useSyncExternalStore } from "react";

export type Theme = "light" | "dark";

const COOKIE = "app_theme";
const ONE_YEAR = 60 * 60 * 24 * 365;

function readTheme(): Theme {
	return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function subscribe(onChange: () => void) {
	const observer = new MutationObserver(onChange);
	observer.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ["data-theme"],
	});
	return () => observer.disconnect();
}

/**
 * The current theme and a setter. The theme lives in `data-theme` on <html>,
 * which inertia_layout.edge renders from the `app_theme` cookie, so every
 * component using this hook stays in sync and the page never flashes.
 */
export function useTheme() {
	const { props } = usePage();
	const theme = useSyncExternalStore(
		subscribe,
		readTheme,
		() => props.preferences?.theme ?? "light",
	);

	const setTheme = useCallback((next: Theme) => {
		document.documentElement.dataset.theme = next;
		// biome-ignore lint/suspicious/noDocumentCookie: the Cookie Store API isn't in every browser yet, and this plain cookie only tells the server which theme to render.
		document.cookie = `${COOKIE}=${next}; path=/; max-age=${ONE_YEAR}; samesite=lax`;
	}, []);

	return { theme, setTheme };
}
