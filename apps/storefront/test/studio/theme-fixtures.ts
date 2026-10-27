import type { Studio } from "@tattoo-drip/sdk";
import { STUDIO } from "./fixtures.ts";

/**
 * Shared by the theme tests (TAT-54). The contract has no `Studio.storefront`
 * yet (src/studio/theme/source.ts), so a config goes on a fixture studio
 * through this cast.
 */
export function withStorefront(storefront: unknown, studio = STUDIO): Studio {
	return { ...studio, storefront } as Studio;
}

/** The origin of the fixtures' photos: the API's, the only one images may come from. */
export const IMAGE_ORIGIN = "https://api.example.com";

export const LOGO = {
	url: "https://api.example.com/uploads/tenants/t/brand_logo/logo.png",
	width: 600,
	height: 200,
	alt: null,
};

export const COVER = {
	url: "https://api.example.com/uploads/tenants/t/cover_photo/cover.jpg",
	width: 2048,
	height: 1024,
	alt: null,
};

/** The same image with smaller copies on the API's origin (TAT-112). */
const withCopies = (image: typeof LOGO, widths: number[]) => ({
	...image,
	variants: widths.map((width) => ({
		url: image.url.replace(/\.(png|jpg)$/, `.${width}w.$1`),
		width,
	})),
});

export const LOGO_SIZED = withCopies(LOGO, [320]);
export const COVER_SIZED = withCopies(COVER, [320, 640, 1280]);

/** The srcset the page builds from a fixture with copies. */
export const srcSetOf = (
	image: typeof LOGO & { variants: { url: string; width: number }[] },
) =>
	[
		...image.variants.map(({ url, width }) => `${url} ${width}w`),
		`${image.url} ${image.width}w`,
	].join(", ");

/** What the cover shows, when the API gave it a description. */
export const COVER_ALT = "The front of Black Needle on Durbar Marg";

/** A studio that set everything: logo, cover, a red accent, the serif face, the inquiry first. */
export const BRANDED = {
	theme: "stencil-and-ink",
	branding: {
		logo: LOGO,
		heroImage: COVER,
		colors: { accent: "#b91c1c" },
		font: "serif",
	},
	sections: [
		{ type: "inquiry", props: {} },
		{ type: "artists", props: {} },
	],
};

/** Every value hostile, and `sections` not a list: this must render as the default theme does. */
export const HOSTILE = {
	theme: "}</style><script>alert(1)</script>",
	branding: {
		logo: { url: "javascript:alert(1)", width: 1, height: 1 },
		heroImage: {
			url: "https://evil.example/cover.jpg",
			width: 2048,
			height: 1024,
		},
		colors: {
			accent: "red;background:url(//evil.example/x.png)",
			accentDark: "}</style><script>alert(1)</script>",
		},
		font: "Comic Sans MS; src: url(//evil.example/font.woff2)",
	},
	sections: "artists;inquiry",
};

/**
 * The studio's cover as the API sends it in `Studio.cover` (TAT-116): always
 * without a description, with copies 640, 960, 1280 and 1600 px wide.
 */
export const API_COVER = {
	url: "https://api.example.com/uploads/tenants/t/studio_cover/cover.jpg",
	width: 2048,
	height: 1536,
	alt: null,
	variants: [640, 960, 1280, 1600].map((width) => ({
		url: `https://api.example.com/uploads/tenants/t/studio_cover/cover.${width}w.jpg`,
		width,
	})),
};

/** The srcset the page builds from API_COVER. */
export const API_COVER_SRCSET = [
	...API_COVER.variants.map(({ url, width }) => `${url} ${width}w`),
	`${API_COVER.url} ${API_COVER.width}w`,
].join(", ");

/** A studio with a cover, the way the API sends one. */
export const withCover = (
	studio: Studio = STUDIO,
	cover: unknown = API_COVER,
) => ({ ...studio, cover }) as Studio;
