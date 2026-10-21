import { storefrontTemplate } from "#modules/payments/deposit_links";
import {
	artistPageUrl,
	pointsAtThisMachine,
	studioAddressParts,
	studioPageUrl,
} from "#services/storefront_url";

/** What the studio link card needs (TAT-101). */
export type StudioLinks = {
	/** The studio page. Open, Copy and Share all use exactly this. */
	url: string;
	/** WhatsApp's share link with `url` encoded, for the "Share" button. */
	shareUrl: string;
	/** The link opens on this machine only (STOREFRONT_URL unset in development). */
	devHost: boolean;
};

/**
 * The studio's page link and how to share it. STOREFRONT_URL (or, unset in
 * development, the dev host) decides the address; `devHost` is true while no
 * client could open it, and the card warns the same way the deposit panel does.
 */
export function studioLinks(
	slug: string,
	template: string = storefrontTemplate(),
): StudioLinks {
	const url = studioPageUrl(template, slug);
	return {
		url,
		shareUrl: `https://wa.me/?text=${encodeURIComponent(url)}`,
		devHost: pointsAtThisMachine(template),
	};
}

/** An artist's own page link under the studio's address. */
export function artistLink(
	studioSlug: string,
	artistSlug: string,
	template: string = storefrontTemplate(),
): string {
	return artistPageUrl(template, studioSlug, artistSlug);
}

/** Before and after the slug in a studio address, for the slug boxes. */
export function studioAddress(template: string = storefrontTemplate()) {
	return studioAddressParts(template);
}
