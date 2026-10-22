import { safeImageUrl } from "../links.ts";

/**
 * A studio's theme (TAT-54): the API's StorefrontConfiguration as the page
 * uses it, after every value has passed an allow-list. Pure. A studio never
 * sends markup, CSS or scripts: its theme is one of this app's React
 * components, picked by key; colours are "#rrggbb"; the font is a key into a
 * fixed list; images are URLs on the API's own origin; sections are known
 * keys. A value that is missing, of the wrong type or not on its list falls
 * back to the default for that value alone.
 */

/** The themes this app has, by key. */
export const THEME_KEYS = ["stencil-and-ink"] as const;
export type ThemeKey = (typeof THEME_KEYS)[number];
export const DEFAULT_THEME_KEY: ThemeKey = "stencil-and-ink";

/** The studio page's sections that a theme can order and hide. */
export const SECTION_KEYS = ["artists", "inquiry"] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

export interface ThemeSections {
	/** Every section the theme shows, in its default order. */
	readonly order: readonly SectionKey[];
	/** Always shown: added at the end when the config leaves one out. */
	readonly required: readonly SectionKey[];
}

/** What each theme supports. The inquiry section is required: a client can always send an idea. */
export const THEME_SECTIONS: Record<ThemeKey, ThemeSections> = {
	"stencil-and-ink": { order: ["artists", "inquiry"], required: ["inquiry"] },
};

/** The display faces a studio can pick (branding.ts maps each to a fixed stack). */
export const FONT_KEYS = ["eczar", "serif", "sans"] as const;
export type FontKey = (typeof FONT_KEYS)[number];
export const DEFAULT_FONT: FontKey = "eczar";

/** A logo or cover image: a checked URL and its stored size. */
export interface BrandImage {
	readonly src: string;
	readonly width: number;
	readonly height: number;
}

export interface ThemeConfig {
	readonly key: ThemeKey;
	/** The sections to show, in order. */
	readonly sections: readonly SectionKey[];
	/** The light scheme's accent, "#rrggbb", or null for the theme's own. */
	readonly accent: string | null;
	/** The dark scheme's accent, "#rrggbb", or null: then it comes from `accent` (branding.ts). */
	readonly accentDark: string | null;
	readonly font: FontKey;
	readonly logo: BrandImage | null;
	/** The cover image above the hero: TAT-116's cover photo, once the platform serves it here. */
	readonly heroImage: BrandImage | null;
}

/** What every studio gets today: the Stencil & Ink page as TAT-97 and TAT-105 built it. */
export const DEFAULT_THEME_CONFIG: ThemeConfig = {
	key: DEFAULT_THEME_KEY,
	sections: THEME_SECTIONS[DEFAULT_THEME_KEY].order,
	accent: null,
	accentDark: null,
	font: DEFAULT_FONT,
	logo: null,
	heroImage: null,
};

/** At most this many section items are read; a longer list is cut. */
const MAX_SECTION_ITEMS = 32;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** An own property only, never one inherited from Object.prototype. */
function own(value: unknown, key: string): unknown {
	return isRecord(value) && Object.hasOwn(value, key) ? value[key] : undefined;
}

function isOneOf<T extends string>(
	list: readonly T[],
	value: unknown,
): value is T {
	return (
		typeof value === "string" && (list as readonly string[]).includes(value)
	);
}

/** A theme this app has, else the default. */
export function readThemeKey(value: unknown): ThemeKey {
	return isOneOf(THEME_KEYS, value) ? value : DEFAULT_THEME_KEY;
}

/** A font key from FONT_KEYS, else the default (Eczar). */
export function readFontKey(value: unknown): FontKey {
	return isOneOf(FONT_KEYS, value) ? value : DEFAULT_FONT;
}

/**
 * The sections to show, in the config's order: the API's `{ type, props }`
 * items whose `type` the theme supports, each once (the first one wins),
 * then each required section the list left out. Anything but a list is the
 * theme's default order. `props` is not read.
 */
export function readSections(value: unknown, theme: ThemeKey): SectionKey[] {
	const { order, required } = THEME_SECTIONS[theme];
	if (!Array.isArray(value)) return [...order];
	const sections: SectionKey[] = [];
	for (const item of value.slice(0, MAX_SECTION_ITEMS)) {
		const type = own(item, "type");
		if (isOneOf(order, type) && !sections.includes(type)) {
			sections.push(type);
		}
	}
	for (const key of required) {
		if (!sections.includes(key)) sections.push(key);
	}
	return sections;
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** "#rrggbb", lowercased, or null: nothing else can reach a CSS variable. */
export function readHexColor(value: unknown): string | null {
	return typeof value === "string" && HEX_COLOR.test(value)
		? value.toLowerCase()
		: null;
}

/** Stored images are at most 2048 px (TAT-44); anything outside this is no image. */
const MAX_IMAGE_SIDE = 10_000;

/**
 * A logo or cover image from the API's `Image` (url, width, height; `alt` is
 * not read: both are decoration beside the studio's name), or null. The URL
 * has no space or control character, passes safeImageUrl (http or https, no
 * credentials, at most 2048 characters) and is on exactly `imageOrigin`, the
 * API's origin: the same scheme, host and port. That one comparison is the
 * rule: the tenancy settings already allow http only for an API on this
 * machine. Without an origin no image is accepted.
 */
export function readBrandImage(
	value: unknown,
	imageOrigin: string | null,
): BrandImage | null {
	const url = own(value, "url");
	const width = own(value, "width");
	const height = own(value, "height");
	if (imageOrigin === null || typeof url !== "string") return null;
	if (/[\s\p{Cc}]/u.test(url)) return null;
	const src = safeImageUrl(url);
	if (src === null) return null;
	const parsed = new URL(src);
	if (parsed.origin !== originOf(imageOrigin)) return null;
	if (!isImageSide(width) || !isImageSide(height)) return null;
	return { src, width, height };
}

function originOf(value: string): string | null {
	try {
		return new URL(value).origin;
	} catch {
		return null;
	}
}

function isImageSide(value: unknown): value is number {
	return (
		Number.isInteger(value) &&
		(value as number) >= 1 &&
		(value as number) <= MAX_IMAGE_SIDE
	);
}

/**
 * The studio's theme from whatever the API sent as `Studio.storefront`
 * (source.ts): `{ theme, branding: { logo, heroImage, colors: { accent,
 * accentDark }, font }, sections }`. Not an object (today: the API sends
 * nothing) is the default theme; each value is checked on its own, and one
 * that fails is that value's default. Images are accepted only from
 * `imageOrigin` (the API's origin; null accepts none).
 */
export function parseThemeConfig(
	input: unknown,
	imageOrigin: string | null,
): ThemeConfig {
	if (!isRecord(input)) return DEFAULT_THEME_CONFIG;
	const key = readThemeKey(own(input, "theme"));
	const branding = own(input, "branding");
	const colors = own(branding, "colors");
	return {
		key,
		sections: readSections(own(input, "sections"), key),
		accent: readHexColor(own(colors, "accent")),
		accentDark: readHexColor(own(colors, "accentDark")),
		font: readFontKey(own(branding, "font")),
		logo: readBrandImage(own(branding, "logo"), imageOrigin),
		heroImage: readBrandImage(own(branding, "heroImage"), imageOrigin),
	};
}
