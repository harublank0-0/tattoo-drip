import type { Artist, FlashPage, Studio, WorkPage } from "@tattoo-drip/sdk";

/** Shared by the studio page tests: whole TAT-44 objects. */

export const ORIGIN = "https://black-needle-48.tattoodrip.com";

/** What the platform sends for a studio that set nothing (TAT-56): the default page look. */
export const DEFAULT_STOREFRONT: Studio["storefront"] = {
	theme: "stencil-and-ink",
	branding: {
		logo: null,
		colors: { accent: null, accentDark: null },
		font: "eczar",
	},
	sections: [
		{ type: "work" },
		{ type: "artists" },
		{ type: "flash" },
		{ type: "info" },
		{ type: "inquiry" },
	],
};

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
	storefront: DEFAULT_STOREFRONT,
	openingHours: [],
	closedDays: [],
	goodToKnow: {
		walkIns: null,
		ageRule: null,
		depositPolicy: null,
		beforeSession: null,
		aftercare: null,
	},
};

/**
 * A studio that filled in hours (Sunday to Friday 11:00 to 20:00, Saturday
 * closed), a closed day with a Devanagari note and every Good to know text,
 * one in Devanagari (TAT-128). 2 November 2026 is a Monday.
 */
export const GOOD_TO_KNOW_STUDIO: Studio = {
	...STUDIO,
	openingHours: (["sun", "mon", "tue", "wed", "thu", "fri"] as const).map(
		(day) => ({ day, opens: "11:00", closes: "20:00" }),
	),
	closedDays: [
		{
			from: "2026-11-02",
			to: "2026-11-04",
			note: "दशैं बिदा, back on 5 November",
		},
	],
	goodToKnow: {
		walkIns: "Small flash welcome on Saturdays.",
		ageRule: "18 and over, with a photo ID.",
		depositPolicy:
			"A deposit holds your date. It is not refunded after 48 hours.",
		beforeSession: "Eat a good meal.\nWear clothes that leave the spot free.",
		aftercare: "घाउ सफा राख्नुहोस्।\nKeep the wrap on for 2 hours.",
	},
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
	styles: [{ slug: "fine-line", name: "Fine line" }],
	socialLinks: [
		{ platform: "instagram", url: "https://instagram.com/sita.ink" },
	],
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
	styles: [],
	socialLinks: [],
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

/**
 * A page of the gallery read (TAT-126) as the API sends it: `count` photos by
 * Sita, on the API's origin with their copies, the first tagged Fine line and
 * healed, no next page, and the filters that go with it. `over` replaces any
 * of the page's own keys.
 */
export function galleryPage(
	count: number,
	over: Partial<WorkPage> = {},
): WorkPage {
	const fineLine = { slug: "fine-line", name: "Fine line" };
	return {
		data: workPhotos(count).map((photo, index) => ({
			...photo,
			styles: index === 0 ? [fineLine] : [],
			healed: index === 0,
			artist: { slug: "sita", name: "Sita Rai" },
		})),
		nextCursor: null,
		filters: { styles: [fineLine], healed: true },
		...over,
	};
}

/** A flash design's picture as the API sends it (TAT-129): on the API's origin, 1200 x 1200 with the photo copies. */
export const flashImage = (n: number) => ({
	url: `https://api.example.com/uploads/tenants/t/flash_design/f${n}.320-640-1280.png`,
	width: 1200,
	height: 1200,
	variants: [320, 640].map((width) => ({
		url: `https://api.example.com/uploads/tenants/t/flash_design/f${n}.${width}w.png`,
		width,
	})),
});

/** The design ids `flashPage` uses: lowercase UUIDs, the first one is `FLASH_ID_1`. */
export const flashId = (n: number) =>
	`0199f000-0000-7000-8000-${String(n).padStart(12, "0")}`;

/**
 * A page of the flash read (TAT-129) as the API sends it: `count` designs by
 * Sita, the first named Moth, About 3 in and NPR 3,000, the rest unpriced, all
 * requestable, no next page, and Sita as the only artist to filter by. `over`
 * replaces any of the page's own keys.
 */
export function flashPage(
	count: number,
	over: Partial<FlashPage> = {},
): FlashPage {
	return {
		data: Array.from({ length: count }, (_, index) => ({
			id: flashId(index + 1),
			name: index === 0 ? "Moth" : `Design ${index + 1}`,
			size: "About 3 in",
			price:
				index === 0
					? { amount: 300000, currency: "NPR" as const, text: "NPR 3,000" }
					: null,
			image: flashImage(index + 1),
			artist: { slug: "sita", name: "Sita Rai" },
			requestable: true,
			status: "available" as const,
		})),
		nextCursor: null,
		filters: { artists: [{ slug: "sita", name: "Sita Rai" }] },
		...over,
	};
}

/** The flash read with no design in it. */
export const EMPTY_FLASH_PAGE: FlashPage = {
	data: [],
	nextCursor: null,
	filters: { artists: [] },
};
