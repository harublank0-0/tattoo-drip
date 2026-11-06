/**
 * The dashboard's appearance (Studio OS): light, dark or the device's
 * setting. Plain data with no imports, so the unit tests can load it.
 *
 * The choice lives in the `app_theme` cookie, which inertia_layout.edge
 * renders as `data-theme` on <html> before the first paint. "System" is no
 * cookie at all: the layout then renders `data-theme="system"` and its inline
 * script resolves it to the device's light or dark setting, so a first visit
 * and a person who picked System behave the same.
 */
export type Theme = "light" | "dark";
export type ThemePreference = Theme | "system";

export const THEME_COOKIE = "app_theme";

/** The choices in the account menu, in order. */
export const THEME_CHOICES: { value: ThemePreference; label: string }[] = [
	{ value: "light", label: "Light" },
	{ value: "dark", label: "Dark" },
	{ value: "system", label: "System" },
];

/** The stored choice in a `document.cookie` string: "system" without a valid cookie. */
export function preferenceFromCookie(cookie: string): ThemePreference {
	for (const part of cookie.split(";")) {
		const [name, value] = part.trim().split("=");
		if (name === THEME_COOKIE && (value === "light" || value === "dark")) {
			return value;
		}
	}
	return "system";
}

/** The `document.cookie` assignment that stores `preference` (System removes the cookie). */
export function themeCookie(preference: ThemePreference): string {
	const oneYear = 60 * 60 * 24 * 365;
	return preference === "system"
		? `${THEME_COOKIE}=; path=/; max-age=0; samesite=lax`
		: `${THEME_COOKIE}=${preference}; path=/; max-age=${oneYear}; samesite=lax`;
}

/** The theme a preference shows, given whether the device prefers dark. */
export function resolveTheme(
	preference: ThemePreference,
	deviceDark: boolean,
): Theme {
	if (preference === "system") return deviceDark ? "dark" : "light";
	return preference;
}
