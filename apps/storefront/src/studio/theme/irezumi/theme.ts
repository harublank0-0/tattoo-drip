import type { Scheme } from "../branding.ts";

/**
 * Irezumi: a light, Japanese-inspired editorial theme on warm paper, with
 * charcoal text and a deep vermilion accent. One colour scheme, whatever the
 * device prefers (`color-scheme: light`), so these values are the whole
 * palette: ./styles.css holds the same ones as CSS variables
 * (test/studio/irezumi.test.ts pins them). Pure: the root document, the
 * brand CSS and the tests read it.
 *
 * Measured contrast on the paper (#f6f1e7) and the raised surface (#ede5d6,
 * the footer and panels): ink 14.9:1 and 13.4:1, ink-muted 6.7:1 and 6.0:1,
 * the vermilion accent #b3321d 5.5:1 and 4.95:1, line-strong 3.7:1 and 3.3:1.
 * Text on an accent fill is the paper (5.5:1). A studio's own accent must
 * read at 4.5:1 on both surfaces (`surfaces`, branding.ts), else the
 * vermilion stays.
 */
export const IREZUMI_SCHEME: Scheme = {
	paper: "#f6f1e7",
	ink: "#1f1d1b",
	inkMuted: "#5a534c",
	surfaces: ["#ede5d6"],
};

/** The class on `<html>` that switches src/styles.css's tokens to Irezumi's. */
export const IREZUMI_CLASS = "theme-irezumi";

/** The browser's own UI around the page (`<meta name="theme-color">`): the paper. */
export const IREZUMI_THEME_COLOR = IREZUMI_SCHEME.paper;
