import { contrastRatio, MIN_TEXT_CONTRAST, mixColors } from "./color.ts";
import type { FontKey, ThemeConfig } from "./config.ts";

/**
 * The CSS a studio's brand adds to its two pages (TAT-54): src/styles.css's
 * stencil tokens for each colour scheme, and the display face. It is built
 * only from ThemeConfig's checked values and the fixed text in this file,
 * and checked once more (isSafeCss) before it leaves, because the router
 * writes it into a <style> in the head as it is. null means the theme's own
 * look: no <style> at all.
 */

/** A colour scheme's fixed colours: src/styles.css's values (test/studio/theme-branding.test.ts pins them). */
export interface Scheme {
	readonly paper: string;
	readonly ink: string;
	readonly inkMuted: string;
}

export const LIGHT: Scheme = {
	paper: "#f7f3ee",
	ink: "#1c1917",
	inkMuted: "#5e5650",
};

export const DARK: Scheme = {
	paper: "#14110f",
	ink: "#efe9e2",
	inkMuted: "#a89f96",
};

/** What an accent sets: --stencil (actions, links, focus, the frame), its hover and its wash. */
export interface AccentTokens {
	readonly stencil: string;
	readonly stencilStrong: string;
	readonly stencilWash: string;
}

/** The wash is the paper with this much of the accent, the first that text on it can still be read on. */
const WASH_SHARES = [0.12, 0.08, 0.04];

/**
 * The stencil tokens for `accent` on `scheme`'s paper, or null when text in
 * the accent can't be read on that paper (under 4.5:1): the scheme then keeps
 * the theme's own violet, all three tokens. --on-stencil (text on the
 * accent) stays the paper colour, which reads as well on the accent as the
 * accent does on the paper. The hover colour is a quarter of the way to the
 * ink, if text on it still passes; the wash is a tint of the paper on which
 * the accent, the ink and the muted ink all pass, else the paper itself.
 */
export function accentTokens(
	accent: string,
	scheme: Scheme,
): AccentTokens | null {
	if (contrastRatio(accent, scheme.paper) < MIN_TEXT_CONTRAST) return null;
	const strong = mixColors(accent, scheme.ink, 0.25);
	return {
		stencil: accent,
		stencilStrong:
			contrastRatio(strong, scheme.paper) >= MIN_TEXT_CONTRAST
				? strong
				: accent,
		stencilWash: washFor(accent, scheme),
	};
}

function washFor(accent: string, scheme: Scheme): string {
	for (const share of WASH_SHARES) {
		const wash = mixColors(scheme.paper, accent, share);
		const readable = [accent, scheme.ink, scheme.inkMuted].every(
			(text) => contrastRatio(text, wash) >= MIN_TEXT_CONTRAST,
		);
		if (readable) return wash;
	}
	return scheme.paper;
}

/**
 * The dark scheme's accent: `accentDark` when it can be read on the dark
 * paper; else `accent`, lightened toward white a tenth at a time until it
 * can (white always can); else null, the theme's own.
 */
export function darkAccent(
	config: Pick<ThemeConfig, "accent" | "accentDark">,
): string | null {
	if (
		config.accentDark !== null &&
		contrastRatio(config.accentDark, DARK.paper) >= MIN_TEXT_CONTRAST
	) {
		return config.accentDark;
	}
	if (config.accent === null) return null;
	for (let step = 0; step <= 10; step += 1) {
		const lighter = mixColors(config.accent, "#ffffff", step / 10);
		if (contrastRatio(lighter, DARK.paper) >= MIN_TEXT_CONTRAST) return lighter;
	}
	return null;
}

/**
 * The display face's stack for each font key; null keeps src/styles.css's
 * (Eczar, vendored). Only faces already on the phone or in this app: a
 * studio's font never downloads anything. Each stack has a Devanagari face
 * and ends in a generic family; no quotes, so isSafeCss can refuse them.
 */
export const DISPLAY_FACES: Record<FontKey, string | null> = {
	eczar: null,
	serif: "Georgia, Noto Serif, Noto Serif Devanagari, Times New Roman, serif",
	sans: "var(--body-face)",
};

/** Only what brandingCss writes: letters, digits, spaces and # : ; , . ( ) { } @ - */
const SAFE_CSS = /^[a-zA-Z0-9 #:;,.(){}@-]*$/;

/** Whether `css` holds nothing brandingCss would not write: no quote, slash, backslash, angle bracket, ampersand or control character. */
export function isSafeCss(css: string): boolean {
	return SAFE_CSS.test(css);
}

function tokenRule(tokens: AccentTokens): string {
	return `html:root{--stencil:${tokens.stencil};--stencil-strong:${tokens.stencilStrong};--stencil-wash:${tokens.stencilWash}}`;
}

/**
 * The brand's CSS, or null for none. Each scheme's tokens sit in that
 * scheme's media query and the face in a plain rule, all on `html:root`,
 * which outranks src/styles.css's `:root` wherever the router puts the tag.
 */
export function brandingCss(config: ThemeConfig): string | null {
	const rules: string[] = [];
	const light =
		config.accent === null ? null : accentTokens(config.accent, LIGHT);
	if (light) {
		rules.push(`@media (prefers-color-scheme: light){${tokenRule(light)}}`);
	}
	const darkColor = darkAccent(config);
	const dark = darkColor === null ? null : accentTokens(darkColor, DARK);
	if (dark) {
		rules.push(`@media (prefers-color-scheme: dark){${tokenRule(dark)}}`);
	}
	const face = DISPLAY_FACES[config.font];
	if (face !== null) rules.push(`html:root{--display-face:${face}}`);
	const css = rules.join("");
	return css !== "" && isSafeCss(css) ? css : null;
}
