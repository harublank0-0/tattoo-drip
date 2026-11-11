import type { Scheme } from "../branding.ts";

/**
 * Atelier: a quiet-luxury theme. Cool stone paper, near-black ink and a deep
 * bronze for everything you can act on, with champagne-brass hairlines as
 * decoration only (never text). One light scheme, whatever the device
 * prefers: ./styles.css holds the same values as CSS variables
 * (test/studio/atelier.test.ts pins them). Pure.
 *
 * Measured contrast on the paper (#f3f1ed), the raised paper (#e9e6e0, the
 * footer and bands) and the white mat (#fbfaf8, behind each piece): ink
 * 16.2, 14.7 and 17.5:1; ink-muted 6.2, 5.6 and 6.7:1; the bronze #7a5a24
 * 5.6, 5.1 and 6.1:1; line-strong 3.5, 3.1 and 3.8:1. Text on a bronze fill is
 * the paper (5.6:1). A studio's own accent is used only where it reads at
 * 4.5:1 on all three (`surfaces`, branding.ts).
 */
export const ATELIER_SCHEME: Scheme = {
	paper: "#f3f1ed",
	ink: "#151515",
	inkMuted: "#5c5953",
	surfaces: ["#e9e6e0", "#fbfaf8"],
};

/** The class on `<html>` that switches src/styles.css's tokens to Atelier's. */
export const ATELIER_CLASS = "theme-atelier";

/** The browser's own UI around the page (`<meta name="theme-color">`): the paper. */
export const ATELIER_THEME_COLOR = ATELIER_SCHEME.paper;
