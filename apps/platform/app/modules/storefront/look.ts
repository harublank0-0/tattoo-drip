/**
 * A studio's page look (TAT-56): what an owner may pick for the studio page,
 * as the storefront's theme reads it (apps/storefront/src/studio/theme/).
 * Pure. Apps may not import each other, so these are copies;
 * tests/unit/modules/storefront/look.spec.ts reads the storefront's files and
 * fails when one drifts. Never markup or CSS: keys from fixed lists and
 * checked "#rrggbb" colours.
 */

export const THEME_KEYS = ["stencil-and-ink"] as const;
export type ThemeKey = (typeof THEME_KEYS)[number];
export const DEFAULT_THEME: ThemeKey = "stencil-and-ink";

export const FONT_KEYS = ["eczar", "serif", "sans"] as const;
export type FontKey = (typeof FONT_KEYS)[number];
export const DEFAULT_FONT: FontKey = "eczar";

/**
 * The studio page's sections an owner can show, hide and order: the newest
 * photos, the artists, Flash (`flash`, TAT-129: the newest flash designs),
 * Good to know (`info`, TAT-128: hours and what clients ask) and the "Got an
 * idea?" invitation to the request page (`inquiry`).
 * The storefront's SECTION_KEYS is the same list in the same order
 * (look.spec.ts compares them, and the contract's
 * `StorefrontSection` list and `sections` `maxItems`). A new section is a key
 * here and there, its place in the storefront theme's `order`, a line in the
 * dashboard's SECTION_WORDS (inertia/components/page_look.ts), the contract's
 * enum and `maxItems`, and a migration for the column's default and for the
 * lists already stored.
 */
export const SECTION_KEYS = [
	"work",
	"artists",
	"flash",
	"info",
	"inquiry",
] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

/**
 * What a new studio shows, in this order: the column's default
 * (tenants.storefront_sections; the columns spec compares them) and the
 * storefront theme's default order.
 */
export const DEFAULT_SECTIONS: readonly SectionKey[] = [
	"work",
	"artists",
	"flash",
	"info",
	"inquiry",
];

/**
 * What the studio page does with one-of-a-kind flash designs somebody has
 * claimed (TAT-129, part 4b): `show` them greyed and marked Claimed (the
 * default), or `hide` them from every public answer. Not part of `PageLook`
 * (the public `Studio.storefront` is unchanged): the flash reads apply it on
 * the platform, so the storefront only ever sees what to show.
 */
export const CLAIMED_FLASH_CHOICES = ["show", "hide"] as const;
export type ClaimedFlash = (typeof CLAIMED_FLASH_CHOICES)[number];
export const DEFAULT_CLAIMED_FLASH: ClaimedFlash = "show";

/** The stored choice, or `show` for anything off today's list (the database checks only the shape). */
export function claimedFlashOf(row: {
	storefrontClaimedFlash: string;
}): ClaimedFlash {
	return isOneOf(CLAIMED_FLASH_CHOICES, row.storefrontClaimedFlash)
		? row.storefrontClaimedFlash
		: DEFAULT_CLAIMED_FLASH;
}

/** The themes an owner can pick, with the words the settings page shows. */
export const THEMES: { key: ThemeKey; label: string; description: string }[] = [
	{
		key: "stencil-and-ink",
		label: "Stencil & Ink",
		description: "Paper, black ink and a violet stencil line. Made for phones.",
	},
];

/** The heading fonts an owner can pick: the label names the face. */
export const FONTS: { key: FontKey; label: string }[] = [
	{ key: "eczar", label: "Eczar (the stencil look)" },
	{ key: "serif", label: "Classic serif" },
	{ key: "sans", label: "Plain" },
];

/** The storefront's papers (branding.ts LIGHT and DARK) and its minimum (color.ts). */
export const LIGHT_PAPER = "#f7f3ee";
export const DARK_PAPER = "#14110f";
export const MIN_TEXT_CONTRAST = 4.5;
/** The theme's own violets (styles.css --stencil, light and dark): where an empty colour picker starts. */
export const THEME_ACCENT = "#43389a";
export const THEME_ACCENT_DARK = "#a99cff";

export const HEX_COLOR = /^#[0-9a-f]{6}$/;

function luminance(color: string): number {
	const [r, g, b] = [1, 3, 5].map((start) => {
		const c = Number.parseInt(color.slice(start, start + 2), 16) / 255;
		return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast of two lowercase "#rrggbb" colours, as the storefront computes it. */
export function contrastRatio(a: string, b: string): number {
	const la = luminance(a);
	const lb = luminance(b);
	return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Whether text in `color` reads on `paper` (4.5:1 or more): what the storefront needs to use it. */
export function readsOn(color: string, paper: string): boolean {
	return (
		HEX_COLOR.test(color) && contrastRatio(color, paper) >= MIN_TEXT_CONTRAST
	);
}

export type PageLook = {
	theme: ThemeKey;
	/** The light scheme's accent, or null for the theme's violet. */
	accent: string | null;
	/** The dark scheme's accent, or null: the storefront lightens `accent`. */
	accentDark: string | null;
	font: FontKey;
	/** The sections shown, in order; always holds "inquiry". */
	sections: SectionKey[];
};

function isOneOf<T extends string>(
	list: readonly T[],
	value: unknown,
): value is T {
	return (
		typeof value === "string" && (list as readonly string[]).includes(value)
	);
}

/**
 * A section list the page can use (the storefront's readSections): the known
 * keys, each once, in the order given, then "inquiry" if it was left out, so
 * the invitation to the request page is always on the page.
 */
export function sectionList(keys: readonly string[]): SectionKey[] {
	const sections: SectionKey[] = [];
	for (const key of keys) {
		if (isOneOf(SECTION_KEYS, key) && !sections.includes(key))
			sections.push(key);
	}
	if (!sections.includes("inquiry")) sections.push("inquiry");
	return sections;
}

/** A stored section list (a comma list) as the page can use it. */
export function sectionsOf(stored: string): SectionKey[] {
	return sectionList(stored.split(","));
}

export type StoredLook = {
	storefrontTheme: string;
	storefrontSections: string;
	brandAccent: string | null;
	brandAccentDark: string | null;
	brandFont: string;
};

/**
 * The look the API serves and the settings page shows: each stored value
 * while it is on today's list (and a colour while it reads on its paper),
 * else that value's default alone. The database checks only the shapes.
 */
export function lookOf(row: StoredLook): PageLook {
	return {
		theme: isOneOf(THEME_KEYS, row.storefrontTheme)
			? row.storefrontTheme
			: DEFAULT_THEME,
		accent:
			row.brandAccent !== null && readsOn(row.brandAccent, LIGHT_PAPER)
				? row.brandAccent
				: null,
		accentDark:
			row.brandAccentDark !== null && readsOn(row.brandAccentDark, DARK_PAPER)
				? row.brandAccentDark
				: null,
		font: isOneOf(FONT_KEYS, row.brandFont) ? row.brandFont : DEFAULT_FONT,
		sections: sectionsOf(row.storefrontSections),
	};
}
