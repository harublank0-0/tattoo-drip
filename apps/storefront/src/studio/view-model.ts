import type { Artist, Studio } from "@tattoo-drip/sdk";
import { fill } from "../intake/template.ts";
import { studioCopy } from "./copy.ts";
import {
	isEmail,
	isPhone,
	linkHostname,
	mailtoLink,
	mapsLink,
	requestHref,
	safeHttpsUrl,
	safeImageUrl,
	telLink,
	viberLink,
	whatsappLink,
} from "./links.ts";
import { largeSource, readSrcSet } from "./srcset.ts";
import { cleanLine, cleanText, locationLine } from "./text.ts";
import { type BrandImage, readBrandImage } from "./theme/config.ts";

/**
 * What the studio page shows (TAT-48), built from TAT-44's allow-list only.
 * Every link is built or checked here; components render these as they are.
 */

/**
 * The shape of an artist slug: a copy of the contract's `ArtistSlug` pattern
 * (packages/types/openapi.yaml), pinned by test/studio/view-model.test.ts.
 */
export const ARTIST_SLUG = /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/;

export type ContactLinkKind =
	| "instagram"
	| "whatsapp"
	| "viber"
	| "call"
	| "email"
	| "facebook"
	| "tiktok"
	| "website"
	| "other";

export interface ContactLink {
	readonly kind: ContactLinkKind;
	readonly label: string;
	readonly href: string;
}

export interface StudioView {
	readonly slug: string;
	readonly name: string;
	readonly type: Studio["type"];
	readonly typeLabel: string;
	readonly intro: string | null;
	readonly accepting: boolean;
	/** E.164, checked. */
	readonly phone: string | null;
	readonly email: string | null;
	readonly address: { readonly text: string; readonly mapsHref: string } | null;
	/** The hero's one location line, from the address ("Thamel, Kathmandu"), or null. */
	readonly location: string | null;
	/** Instagram first, then the ways to reach the studio, then other places. */
	readonly links: readonly ContactLink[];
	/** The social links' https URLs, in the API's order (JSON-LD `sameAs`). */
	readonly socialUrls: readonly string[];
}

export interface ArtistPhoto {
	readonly src: string;
	readonly width: number;
	readonly height: number;
	readonly alt: string;
	/** The photo and its smaller copies, when the API sent any (readSrcSet, TAT-112). */
	readonly srcSet?: string;
}

/** The most work photos an artist shows (the contract's maxItems). */
export const MAX_WORK_PHOTOS = 6;
/** The longest description kept, in characters; a longer one is no description. */
const MAX_WORK_ALT = 200;

/** One photo of an artist's work (TAT-116), checked: see workPhotoViews. */
export interface WorkPhotoView extends BrandImage {
	/** The studio's description, else "Tattoo by {name}, photo {n} of {count}". */
	readonly alt: string;
	/** The studio's description for the viewer, or null. */
	readonly caption: string | null;
	/** What the viewer shows (largeSource). */
	readonly largeSrc: string;
	/** The viewer's `<dialog>` id. */
	readonly dialogId: string;
	/** "Photo {n} of {count}". */
	readonly label: string;
}

export interface ArtistView {
	readonly id: string;
	readonly slug: string;
	readonly name: string;
	readonly bio: string | null;
	readonly photo: ArtistPhoto | null;
	readonly accepting: boolean;
	/** Only while the artist isn't accepting inquiries. */
	readonly closedMessage: string | null;
	readonly pageHref: string;
	/** `/request?artist=<slug>`: asks for this artist (TAT-127). */
	readonly requestHref: string;
	/** The artist's six newest work photos, newest first (TAT-116, TAT-126); the whole portfolio is the gallery's. */
	readonly workPhotos: readonly WorkPhotoView[];
	/** The names of up to five tattoo styles, in the API's order; [] when none. */
	readonly styles: readonly string[];
	/** The artist's Instagram, Facebook and TikTok links that pass the checks; [] when none. */
	readonly links: readonly ContactLink[];
}

/** The most styles an artist shows (the contract's maxItems). */
const MAX_STYLES = 5;

const TYPE_LABELS: Record<Studio["type"], string> = {
	studio: "Tattoo studio",
	independent: "Independent tattoo artist",
};

const SOCIAL: Record<string, { kind: ContactLinkKind; label: string }> = {
	instagram: { kind: "instagram", label: "Instagram" },
	facebook: { kind: "facebook", label: "Facebook" },
	tiktok: { kind: "tiktok", label: "TikTok" },
	website: { kind: "website", label: "Website" },
};

const LINK_ORDER: readonly ContactLinkKind[] = [
	"instagram",
	"whatsapp",
	"viber",
	"call",
	"email",
	"facebook",
	"tiktok",
	"website",
	"other",
];

/**
 * Photos are at most 2048 px (TAT-44); anything outside this is no photo. The
 * photo's smaller copies must be on its own origin (readSrcSet, TAT-112); the
 * photo itself may be on any http(s) origin (TAT-54's known limit).
 */
const MAX_PHOTO_SIDE = 10_000;

export function studioViewModel(studio: Studio): StudioView {
	const name = cleanLine(studio.name) ?? studio.slug;
	const phone = isPhone(studio.contact.phone) ? studio.contact.phone : null;
	const email = isEmail(studio.contact.email) ? studio.contact.email : null;
	const addressText = cleanText(studio.contact.address);

	const social = socialContactLinks(studio.socialLinks);

	const contact: ContactLink[] = [];
	const whatsapp = whatsappLink(phone);
	if (whatsapp)
		contact.push({ kind: "whatsapp", label: "WhatsApp", href: whatsapp });
	const viber = viberLink(phone);
	if (viber) contact.push({ kind: "viber", label: "Viber", href: viber });
	const call = telLink(phone);
	if (call) contact.push({ kind: "call", label: "Call", href: call });
	const mail = mailtoLink(email);
	if (mail) contact.push({ kind: "email", label: "Email", href: mail });

	// Array.prototype.sort is stable: links of one kind keep the API's order.
	const links = [...social, ...contact].sort(
		(a, b) => LINK_ORDER.indexOf(a.kind) - LINK_ORDER.indexOf(b.kind),
	);

	return {
		slug: studio.slug,
		name,
		type: studio.type,
		typeLabel: Object.hasOwn(TYPE_LABELS, studio.type)
			? TYPE_LABELS[studio.type]
			: TYPE_LABELS.studio,
		intro: cleanText(studio.intro),
		accepting: studio.acceptingInquiries === true,
		phone,
		email,
		address: addressText
			? {
					text: addressText,
					mapsHref: mapsLink(`${name}, ${addressText.replace(/\n+/g, ", ")}`),
				}
			: null,
		location: locationLine(addressText),
		links,
		socialUrls: social.map((link) => link.href),
	};
}

/**
 * The social links as links a visitor can follow, in the API's order: an https
 * URL without credentials (safeHttpsUrl), a known platform named ("Instagram"),
 * any other labelled by its host. An item that is not a link is dropped, and
 * anything but a list (an older API sends none) is []. Pure.
 */
export function socialContactLinks(value: unknown): ContactLink[] {
	if (!Array.isArray(value)) return [];
	const links: ContactLink[] = [];
	for (const item of value) {
		if (typeof item !== "object" || item === null) continue;
		const { platform, url } = item as { platform?: unknown; url?: unknown };
		const href = safeHttpsUrl(url);
		if (!href) continue;
		const known =
			typeof platform === "string" && Object.hasOwn(SOCIAL, platform)
				? SOCIAL[platform]
				: undefined;
		links.push({
			kind: known?.kind ?? "other",
			label: known?.label ?? linkHostname(href),
			href,
		});
	}
	return links;
}

/**
 * An artist's tattoo style names from the API's `styles`: one line of plain
 * text each (cleanLine), in the API's order, at most five. An item without a
 * text name is dropped, and anything but a list (an older API sends none) is
 * []. Pure.
 */
export function styleNames(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const names: string[] = [];
	for (const item of value) {
		if (typeof item !== "object" || item === null) continue;
		const { name } = item as { name?: unknown };
		const line = typeof name === "string" ? cleanLine(name) : null;
		if (line) names.push(line);
	}
	return names.slice(0, MAX_STYLES);
}

/**
 * The visible artists as the page shows them; one whose slug can't be a link
 * is left out. `imageOrigin` is the API's origin, the only one a work photo
 * may come from (TAT-116); null accepts none.
 */
export function artistViewModels(
	artists: readonly Artist[],
	imageOrigin: string | null = null,
): ArtistView[] {
	return artists
		.filter((artist) => ARTIST_SLUG.test(artist.slug))
		.map((artist) => artistViewModel(artist, imageOrigin));
}

/** The artist with exactly this slug, or null. */
export function findArtist(
	artists: readonly ArtistView[],
	slug: string,
): ArtistView | null {
	if (!ARTIST_SLUG.test(slug)) return null;
	return artists.find((artist) => artist.slug === slug) ?? null;
}

function artistViewModel(
	artist: Artist,
	imageOrigin: string | null,
): ArtistView {
	const name = cleanLine(artist.name) ?? artist.slug;
	const accepting = artist.acceptingInquiries === true;
	return {
		id: artist.id,
		slug: artist.slug,
		name,
		bio: cleanText(artist.bio),
		photo: photoView(artist.photo, name),
		accepting,
		closedMessage: accepting ? null : cleanText(artist.closedMessage),
		pageHref: `/artists/${artist.slug}`,
		requestHref: requestHref({ artist: artist.slug }),
		workPhotos: workPhotoViews(
			(artist as { readonly workPhotos?: unknown }).workPhotos,
			name,
			imageOrigin,
		),
		styles: styleNames(artist.styles),
		links: socialContactLinks(artist.socialLinks),
	};
}

/**
 * An artist's work photos from the API's `workPhotos` (TAT-116): at most six,
 * each passing the brand images' rule (readBrandImage: the API's origin only,
 * sides from 1 to 10000, copies on the same origin), the rest dropped and the
 * others renumbered. Anything but a list (an older API sends none) is []. The
 * description is plain text on one line, up to 200 characters, else
 * "Tattoo by {name}, photo {n} of {count}"; the viewer shows the widest copy
 * up to 1280 px. Pure.
 */
export function workPhotoViews(
	value: unknown,
	name: string,
	imageOrigin: string | null,
): WorkPhotoView[] {
	if (!Array.isArray(value)) return [];
	const kept = value.slice(0, MAX_WORK_PHOTOS).flatMap((item) => {
		const image = readBrandImage(item, imageOrigin);
		return image ? [{ item, image }] : [];
	});
	return kept.map(({ item, image }, index) => {
		const raw =
			typeof item === "object" && item !== null && Object.hasOwn(item, "alt")
				? (item as { alt: unknown }).alt
				: null;
		const line = typeof raw === "string" ? cleanLine(raw) : null;
		const caption =
			line && Array.from(line).length <= MAX_WORK_ALT ? line : null;
		const values = { name, n: index + 1, count: kept.length };
		return {
			...image,
			alt: caption ?? fill(studioCopy.work.fallbackAlt, values),
			caption,
			largeSrc: largeSource(image),
			dialogId: `work-photo-${index + 1}`,
			label: fill(studioCopy.work.photoOf, values),
		};
	});
}

function photoView(photo: Artist["photo"], name: string): ArtistPhoto | null {
	if (!photo) return null;
	const src = safeImageUrl(photo.url);
	if (!src || !isSide(photo.width) || !isSide(photo.height)) return null;
	const srcSet = readSrcSet(photo.variants, src, photo.width);
	return {
		src,
		width: photo.width,
		height: photo.height,
		alt: `Photo of ${name}`,
		...(srcSet ? { srcSet } : {}),
	};
}

function isSide(value: unknown): value is number {
	return (
		Number.isInteger(value) &&
		(value as number) >= 1 &&
		(value as number) <= MAX_PHOTO_SIDE
	);
}
