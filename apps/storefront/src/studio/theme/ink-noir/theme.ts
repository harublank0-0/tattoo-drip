import type { Scheme } from "../branding.ts";

/**
 * Ink Noir: a dark, photography-first theme. One colour scheme, whatever the
 * device prefers, so these values are the whole palette: ./styles.css holds
 * the same ones as CSS variables (test/studio/ink-noir.test.ts pins them).
 * Pure: the root document, the brand CSS and the tests read it.
 *
 * Measured contrast on the paper (#101112): ink 16.6:1, ink-muted 7.7:1,
 * accent 5.4:1 (5.0:1 on the raised surface), line-strong 4.3:1. The
 * reference accent #d54845 reads at only 4.4:1 there, so the accent is that
 * red lightened until body-size text in it passes; text on an accent button
 * is the paper, as in Stencil & Ink's dark scheme (a light text on that red
 * would be 3.1:1).
 */
export const INK_NOIR_SCHEME: Scheme = {
	paper: "#101112",
	ink: "#f4f0ea",
	inkMuted: "#a5a5a5",
};

/** The class on `<html>` that switches src/styles.css's tokens to Ink Noir's. */
export const INK_NOIR_CLASS = "theme-ink-noir";

/** The browser's own UI around the page (`<meta name="theme-color">`): the paper. */
export const INK_NOIR_THEME_COLOR = INK_NOIR_SCHEME.paper;
