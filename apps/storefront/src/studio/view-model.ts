import type { Artist, Studio } from "@tattoo-drip/sdk";
import {
	isEmail,
	isPhone,
	linkHostname,
	mailtoLink,
	mapsLink,
	safeHttpsUrl,
	safeImageUrl,
	telLink,
	viberLink,
	whatsappLink,
} from "./links.ts";
import { cleanLine, cleanText } from "./text.ts";

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
	readonly inquiryHref: string;
}

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

/** Photos are at most 2048 px (TAT-44); anything outside this is no photo. */
const MAX_PHOTO_SIDE = 10_000;

export function studioViewModel(studio: Studio): StudioView {
	const name = cleanLine(studio.name) ?? studio.slug;
	const phone = isPhone(studio.contact.phone) ? studio.contact.phone : null;
	const email = isEmail(studio.contact.email) ? studio.contact.email : null;
	const addressText = cleanText(studio.contact.address);

	const social: ContactLink[] = [];
	for (const link of studio.socialLinks) {
		const href = safeHttpsUrl(link.url);
		if (!href) continue;
		const known = Object.hasOwn(SOCIAL, link.platform)
			? SOCIAL[link.platform]
			: undefined;
		social.push({
			kind: known?.kind ?? "other",
			label: known?.label ?? linkHostname(href),
			href,
		});
	}

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
		typeLabel: TYPE_LABELS[studio.type] ?? TYPE_LABELS.studio,
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
		links,
		socialUrls: social.map((link) => link.href),
	};
}

/** The visible artists as the page shows them; one whose slug can't be a link is left out. */
export function artistViewModels(artists: readonly Artist[]): ArtistView[] {
	return artists
		.filter((artist) => ARTIST_SLUG.test(artist.slug))
		.map(artistViewModel);
}

/** The artist with exactly this slug, or null. */
export function findArtist(
	artists: readonly ArtistView[],
	slug: string,
): ArtistView | null {
	if (!ARTIST_SLUG.test(slug)) return null;
	return artists.find((artist) => artist.slug === slug) ?? null;
}

function artistViewModel(artist: Artist): ArtistView {
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
		inquiryHref: `/artists/${artist.slug}#inquiry`,
	};
}

function photoView(photo: Artist["photo"], name: string): ArtistPhoto | null {
	if (!photo) return null;
	const src = safeImageUrl(photo.url);
	if (!src || !isSide(photo.width) || !isSide(photo.height)) return null;
	return {
		src,
		width: photo.width,
		height: photo.height,
		alt: `Photo of ${name}`,
	};
}

function isSide(value: unknown): value is number {
	return (
		Number.isInteger(value) &&
		(value as number) >= 1 &&
		(value as number) <= MAX_PHOTO_SIDE
	);
}
