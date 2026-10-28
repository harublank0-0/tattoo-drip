import type { Artist, Studio } from "@tattoo-drip/sdk";

/** Shared by the studio page tests: whole TAT-44 objects. */

export const ORIGIN = "https://black-needle-48.tattoodrip.com";

export const STUDIO: Studio = {
	slug: "black-needle-48",
	name: "Black Needle",
	type: "studio",
	intro: "Fine line and blackwork in Thamel.\r\nWalk-ins on Sundays.",
	timezone: "Asia/Kathmandu",
	contact: {
		phone: "+9779812345678",
		email: "hello@black-needle.example",
		address: "Thamel Marg\nKathmandu",
	},
	socialLinks: [
		{ platform: "instagram", url: "https://instagram.com/blackneedle" },
		{ platform: "facebook", url: "https://facebook.com/blackneedle" },
		{ platform: "tiktok", url: "https://www.tiktok.com/@blackneedle" },
		{ platform: "website", url: "https://black-needle.example" },
	],
	acceptingInquiries: true,
	cover: null,
};

/** A studio that set nothing but its name. */
export const EMPTY_STUDIO: Studio = {
	...STUDIO,
	intro: null,
	contact: { phone: null, email: null, address: null },
	socialLinks: [],
};

/** Every visible artist closed. */
export const CLOSED_STUDIO: Studio = { ...STUDIO, acceptingInquiries: false };

export const SITA_PHOTO_URL =
	"https://api.example.com/uploads/tenants/t/artist_photo/sita.jpg";

export const SITA: Artist = {
	id: "0199f000-0000-7000-8000-000000000048",
	slug: "sita",
	name: "Sita Rai",
	bio: "Fine line florals.\nBooks a month ahead.",
	photo: { url: SITA_PHOTO_URL, width: 1200, height: 1500, variants: [] },
	acceptingInquiries: true,
	closedMessage: null,
	workPhotos: [],
};

/** The photo's smaller copies, as the API lists them (TAT-112). */
export const SITA_VARIANTS = [
	{
		url: "https://api.example.com/uploads/tenants/t/artist_photo/sita.320w.jpg",
		width: 320,
	},
	{
		url: "https://api.example.com/uploads/tenants/t/artist_photo/sita.640w.jpg",
		width: 640,
	},
];

/** Sita with a photo that has two smaller copies. */
export const SITA_SIZED: Artist = {
	...SITA,
	photo: {
		url: SITA_PHOTO_URL,
		width: 1200,
		height: 1500,
		variants: SITA_VARIANTS,
	},
};

/** The srcset the page builds from SITA_SIZED. */
export const SITA_SRCSET = `${SITA_VARIANTS[0].url} 320w, ${SITA_VARIANTS[1].url} 640w, ${SITA_PHOTO_URL} 1200w`;

/** Closed, no photo, a Devanagari name. */
export const ARJUN: Artist = {
	id: "0199f000-0000-7000-8000-000000000049",
	slug: "arjun",
	name: "अर्जुन थापा",
	bio: null,
	photo: null,
	acceptingInquiries: false,
	closedMessage: "Books open in March.",
	workPhotos: [],
};

/**
 * `count` photos of an artist's work as the API sends them (TAT-116): on the
 * API's origin, 2048 x 1536 with the photo copies, the first with a
 * description.
 */
export function workPhotos(count: number, alts: (string | null)[] = []) {
	return Array.from({ length: count }, (_, index) => ({
		url: `https://api.example.com/uploads/tenants/t/artist_work_photo/w${index + 1}.320-640-1280.jpg`,
		width: 2048,
		height: 1536,
		alt: alts[index] ?? null,
		variants: [320, 640, 1280].map((width) => ({
			url: `https://api.example.com/uploads/tenants/t/artist_work_photo/w${index + 1}.${width}w.jpg`,
			width,
		})),
	}));
}

/** Sita with `count` work photos. */
export const sitaWithWork = (
	count: number,
	alts: (string | null)[] = [],
): Artist => ({
	...SITA,
	workPhotos: workPhotos(count, alts),
});
