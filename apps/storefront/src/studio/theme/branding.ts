import type { ChallengeTheme } from "../../intake/challenge.ts";
import { contrastRatio, MIN_TEXT_CONTRAST, mixColors } from "./color.ts";
import type { FontKey, ThemeConfig, ThemeKey } from "./config.ts";
import { THEME_HTML } from "./html.ts";

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
	/**
	 * Other backgrounds the theme puts text on (a raised surface for its
	 * footer and panels), which an accent must read on as well as the paper.
	 * None for Stencil & Ink's two schemes and Ink Noir.
	 */
	readonly surfaces?: readonly string[];
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
	if (!readsOnScheme(accent, scheme)) return null;
	const strong = mixColors(accent, scheme.ink, 0.25);
	return {
		stencil: accent,
		stencilStrong: readsOnScheme(strong, scheme) ? strong : accent,
		stencilWash: washFor(accent, scheme),
	};
}

/** Whether text in `color` reads at 4.5:1 on the scheme's paper and on each of its other surfaces. */
function readsOnScheme(color: string, scheme: Scheme): boolean {
	return [scheme.paper, ...(scheme.surfaces ?? [])].every(
		(surface) => contrastRatio(color, surface) >= MIN_TEXT_CONTRAST,
	);
}

/**
 * The booking form's Turnstile widget colours for a theme: its one fixed
 * scheme (Ink Noir is dark, Atelier light), so the widget matches the page
 * whatever the device prefers; `auto` (the device's) for a theme that
 * follows the device, as Stencil & Ink and Irezumi do.
 */
export function challengeThemeFor(key: ThemeKey): ChallengeTheme {
	const { scheme } = THEME_HTML[key];
	if (scheme === null) return "auto";
	return isLightScheme(scheme) ? "light" : "dark";
}

/** Whether a scheme's paper is light: dark text reads better on it than white does. */
export function isLightScheme(scheme: Scheme): boolean {
	return (
		contrastRatio(scheme.paper, "#000000") >
		contrastRatio(scheme.paper, "#ffffff")
	);
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
 * paper and every other surface of the scheme; else `accent`, lightened
 * toward white a tenth at a time until it can (white always can on a dark
 * scheme); else null, the theme's own. `scheme` is the dark scheme it must
 * read on: Stencil & Ink's, a dark theme's one scheme (Ink Noir's), or a
 * theme's own dark scheme (Irezumi's).
 */
export function darkAccent(
	config: Pick<ThemeConfig, "accent" | "accentDark">,
	scheme: Scheme = DARK,
): string | null {
	if (config.accentDark !== null && readsOnScheme(config.accentDark, scheme)) {
		return config.accentDark;
	}
	if (config.accent === null) return null;
	for (let step = 0; step <= 10; step += 1) {
		const lighter = mixColors(config.accent, "#ffffff", step / 10);
		if (readsOnScheme(lighter, scheme)) return lighter;
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

/** Only these characters: letters, digits, spaces and # : ; , . ( ) { } @ - */
const SAFE_CSS = /^[a-zA-Z0-9 #:;,.(){}@-]*$/;

/** The CSS that loads or runs something, with or without a slash-free target: brandingCss writes none of it. */
const LOADS_OR_RUNS = /url\(|@import|expression\(|@charset/i;

/**
 * Whether `css` passes two checks: every character is a letter, digit, space
 * or one of # : ; , . ( ) { } @ - (so no quote, slash, backslash, angle
 * bracket, ampersand or control character), and it holds neither `url(`,
 * `@import`, `expression(` nor `@charset`, in any letter case. It does not
 * parse the CSS: the text is safe because brandingCss builds it from fixed
 * strings and checked `#rrggbb` values, and this is a second line behind that.
 */
export function isSafeCss(css: string): boolean {
	return SAFE_CSS.test(css) && !LOADS_OR_RUNS.test(css);
}

function tokenRule(tokens: AccentTokens, selector = "html:root"): string {
	return `${selector}{--stencil:${tokens.stencil};--stencil-strong:${tokens.stencilStrong};--stencil-wash:${tokens.stencilWash}}`;
}

/**
 * The brand's CSS, or null for none. Each scheme's tokens sit in that
 * scheme's media query and the face in a plain rule, all on `html:root`,
 * which outranks src/styles.css's `:root` wherever the router puts the tag.
 *
 * A theme with one fixed scheme (THEME_HTML's `scheme`: Ink Noir is always
 * dark, Atelier always light) gets one rule instead, with no media query, on
 * `html:root.<the theme's class>`, which outranks the theme's tokens
 * (`:root.<class>`). A dark one takes the accent as the dark scheme does
 * (`accentDark`, else the accent lightened); a light one takes `accent` as it
 * is, only while it reads on the paper and every other surface of the theme
 * (the scheme's `surfaces`), else it keeps the theme's own. Either is checked
 * against that theme's own colours, not Stencil & Ink's.
 *
 * A theme with its own class that follows the device (THEME_HTML's
 * `schemes`: Irezumi) gets both media queries, as Stencil & Ink does, but on
 * `html:root.<the theme's class>` and checked against its own two schemes.
 */
export function brandingCss(config: ThemeConfig): string | null {
	const rules: string[] = [];
	const { scheme, schemes, className } = THEME_HTML[config.key];
	const selector = className === null ? "html:root" : `html:root.${className}`;
	if (scheme !== null) {
		const color = isLightScheme(scheme)
			? config.accent
			: darkAccent(config, scheme);
		const tokens = color === null ? null : accentTokens(color, scheme);
		if (tokens) rules.push(tokenRule(tokens, selector));
	} else {
		const { light: lightScheme, dark: darkScheme } = schemes ?? {
			light: LIGHT,
			dark: DARK,
		};
		const light =
			config.accent === null ? null : accentTokens(config.accent, lightScheme);
		if (light) {
			rules.push(
				`@media (prefers-color-scheme: light){${tokenRule(light, selector)}}`,
			);
		}
		const darkColor = darkAccent(config, darkScheme);
		const dark =
			darkColor === null ? null : accentTokens(darkColor, darkScheme);
		if (dark) {
			rules.push(
				`@media (prefers-color-scheme: dark){${tokenRule(dark, selector)}}`,
			);
		}
	}
	// On a theme's own class where it has one (0,2,1), so a theme that sets its
	// own face (Atelier's Bodoni) still yields to the studio's pick.
	const face = DISPLAY_FACES[config.font];
	if (face !== null) rules.push(`${selector}{--display-face:${face}}`);
	const css = rules.join("");
	return css !== "" && isSafeCss(css) ? css : null;
}
