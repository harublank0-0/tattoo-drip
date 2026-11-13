import type { Scheme } from "../branding.ts";

/**
 * Flash Parlour: a traditional walk-in shop's wall of flash. A warm cream
 * ground, heavy black ink outlines and a few flat traditional colours: red
 * for everything you can act on, mustard and deep green as fills and
 * decoration. One light scheme, whatever the device prefers: ./styles.css
 * holds the same values as CSS variables (test/studio/flash-parlour.test.ts
 * pins them). Pure.
 *
 * Measured contrast on the cream paper (#f5ead3), the raised cream (#ecdcb8:
 * the wall behind the flash and the bands) and the sheet (#fdf8ec: each flash
 * sheet and photo mat): ink 15.1, 13.3 and 17.0:1; ink-muted 7.1, 6.2 and
 * 8.0:1; the red #b02a1b 5.5, 4.9 and 6.2:1; the green #1e5b3f 6.7, 5.9 and
 * 7.6:1; line-strong 4.6, 4.0 and 5.2:1. Text on a red fill is the paper
 * (5.5:1); text on a mustard fill is the ink (8.3:1). The mustard itself
 * (#e2a628, 1.8:1 on the paper) is a fill only, never text on cream. A
 * studio's own accent is used only where it reads at 4.5:1 on all three
 * (`surfaces`, branding.ts).
 */
export const FLASH_PARLOUR_SCHEME: Scheme = {
	paper: "#f5ead3",
	ink: "#1a1613",
	inkMuted: "#5b4a38",
	surfaces: ["#ecdcb8", "#fdf8ec"],
};

/** The class on `<html>` that switches src/styles.css's tokens to Flash Parlour's. */
export const FLASH_PARLOUR_CLASS = "theme-flash-parlour";

/** The browser's own UI around the page (`<meta name="theme-color">`): the paper. */
export const FLASH_PARLOUR_THEME_COLOR = FLASH_PARLOUR_SCHEME.paper;
