/**
 * The tattoo styles an artist can pick (TAT-125). A fixed
 * list: the slug is what is stored and sent, the name is what people read.
 * Both stay in this order wherever styles are shown.
 */
export const TATTOO_STYLES = Object.freeze([
	Object.freeze({ slug: "blackwork", name: "Blackwork" }),
	Object.freeze({ slug: "fine-line", name: "Fine line" }),
	Object.freeze({ slug: "traditional", name: "Traditional" }),
	Object.freeze({ slug: "neo-traditional", name: "Neo-traditional" }),
	Object.freeze({ slug: "realism", name: "Realism" }),
	Object.freeze({ slug: "black-and-grey", name: "Black and grey" }),
	Object.freeze({ slug: "colour", name: "Colour" }),
	Object.freeze({ slug: "watercolour", name: "Watercolour" }),
	Object.freeze({ slug: "japanese", name: "Japanese" }),
	Object.freeze({ slug: "tribal", name: "Tribal" }),
	Object.freeze({ slug: "mandala", name: "Mandala" }),
	Object.freeze({ slug: "geometric", name: "Geometric" }),
	Object.freeze({ slug: "dotwork", name: "Dotwork" }),
	Object.freeze({ slug: "lettering", name: "Lettering" }),
	Object.freeze({ slug: "minimal", name: "Minimal" }),
	Object.freeze({ slug: "portrait", name: "Portrait" }),
	Object.freeze({
		slug: "religious-and-spiritual",
		name: "Religious and spiritual",
	}),
	Object.freeze({ slug: "cover-up", name: "Cover-up" }),
] as const);

export type StyleSlug = (typeof TATTOO_STYLES)[number]["slug"];

export type TattooStyleRef = { slug: StyleSlug; name: string };

export const STYLE_SLUGS: readonly StyleSlug[] = TATTOO_STYLES.map(
	({ slug }) => slug,
);

/** The most styles one artist can pick; the database checks it too. */
export const MAX_ARTIST_STYLES = 5;

/** The most styles one work photo can carry (TAT-126); the database checks it too. */
export const MAX_PHOTO_STYLES = 3;

/**
 * The shape every style slug has: lowercase letters and digits in groups
 * joined by single hyphens. It says nothing about the list: code that takes
 * a slug from outside (a URL, say) can refuse garbage with it before
 * looking anything up.
 */
export const STYLE_SLUG_SHAPE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * The listed styles among `slugs`, in the list's order. Unknown and repeated
 * slugs are dropped, so a slug that later leaves the list just disappears.
 */
export function knownStyles(slugs: readonly string[]): TattooStyleRef[] {
	const wanted = new Set(slugs);
	return TATTOO_STYLES.filter(({ slug }) => wanted.has(slug)).map(
		({ slug, name }) => ({ slug, name }),
	);
}
