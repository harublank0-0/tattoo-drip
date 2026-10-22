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
