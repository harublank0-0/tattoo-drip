import type { Scheme } from "../branding.ts";

/**
 * Irezumi: a Japanese-inspired editorial theme on washi paper with a faint
 * seigaiha (wave) pattern, charcoal text and a vermilion accent. It follows
 * the device: warm paper on a light one, sumi-ink paper on a dark one
 * (`prefers-color-scheme`), so these two schemes are the whole palette:
 * ./styles.css holds the same values as CSS variables
 * (test/studio/irezumi.test.ts pins them). Pure: the root document, the
 * brand CSS and the tests read it.
 *
 * Light, on the paper (#f6f1e7) and the raised surface (#ede5d6, the footer
 * and panels): ink 14.9:1 and 13.4:1, ink-muted 6.7:1 and 6.0:1, the
 * vermilion #b3321d 5.5:1 and 4.95:1, line-strong 3.7:1 and 3.3:1.
 *
 * Dark, on the paper (#161412) and the raised surface (#201d1a): ink 14.8:1
 * and 13.5:1, ink-muted 7.1:1 and 6.5:1, the lighter vermilion #e36b54 5.7:1
 * and 5.2:1, line-strong 3.9:1 and 3.5:1.
 *
 * Text on an accent fill is the paper (5.5:1 light, 5.7:1 dark).
 *
 * The paper's texture (./styles.css: a grain and the seigaiha waves) darkens
 * the light paper and lightens the dark one where it lies. So each scheme's
 * `surfaces` also hold the textured paper and raised paper at their 95th
 * percentile, measured in Chromium (light: 95% of the pixels are lighter;
 * dark: 95% are darker): text that reads on those reads on almost all of the
 * texture under it, not just on its average. The vermilion reads at 4.67:1
 * and 4.77:1 on the light ones, 4.67:1 and 4.84:1 on the dark ones. A
 * studio's own accent must read at 4.5:1 on every surface of a scheme
 * (branding.ts), else that scheme keeps the vermilion.
 */
export const IREZUMI_SCHEME: Scheme = {
	paper: "#f6f1e7",
	ink: "#1f1d1b",
	inkMuted: "#5a534c",
	// The raised paper; then the paper and the raised paper under their texture (95th percentile).
	surfaces: ["#ede5d6", "#e4dfd6", "#e9e1d2"],
};

/** The dark scheme: sumi-ink paper, for a device that prefers dark. */
export const IREZUMI_DARK_SCHEME: Scheme = {
	paper: "#161412",
	ink: "#ede6da",
	inkMuted: "#a8a095",
	// The raised paper; then the paper and the raised paper under their texture (95th percentile).
	surfaces: ["#201d1a", "#282623", "#262320"],
};

/** The class on `<html>` that switches src/styles.css's tokens to Irezumi's. */
export const IREZUMI_CLASS = "theme-irezumi";

/** The browser's own UI around the page (`<meta name="theme-color">`): each scheme's paper. */
export const IREZUMI_THEME_COLORS = [
	{
		content: IREZUMI_SCHEME.paper,
		media: "(prefers-color-scheme: light)",
	},
	{
		content: IREZUMI_DARK_SCHEME.paper,
		media: "(prefers-color-scheme: dark)",
	},
] as const;
