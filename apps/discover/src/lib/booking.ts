/**
 * The booking hand-off (D08, docs/discover/frontend.md, "Booking hand-off"):
 * where a profile's "Request a session" and "Visit studio site" go. Pure.
 *
 * Discover never makes a booking or a token. The platform builds every
 * profile's `bookingUrl` (the studio site's `/book`, with `artist` for an
 * artist and Discover's signed referral `ref`) and its `storefrontUrl`; this
 * module only decides whether each is safe to link, and rebuilds the booking
 * link from its checked parts, so nothing else in an answer (another host, a
 * path, a stray parameter) can ever reach the page:
 *
 * - Both URLs must be https, or http on `localhost` / `*.localhost` (a
 *   developer's studio pages), with no user name or password.
 * - The booking link's host must be its storefront page's host (the API
 *   builds both from STOREFRONT_URL for the same studio), and its path the
 *   storefront's `/book`.
 * - Only the storefront's parameters survive: `artist` (an artist profile
 *   only, and only the profile's own slug: the storefront preselects by it,
 *   checked against that studio's artists), `artwork` (D09: an artwork page
 *   only, and only that photo's own id: the storefront's "Request a similar
 *   tattoo", which it checks with the API and which names the photo's
 *   artist) and `ref` (by shape: the platform verifies it; Discover only
 *   carries it). Never `flash`: portfolio photos are not flash designs.
 *
 * Anything else is no link at all: the page then says booking isn't
 * available online here, never a guess.
 */

/** The storefront's booking page (apps/storefront `src/routes/book.tsx`). */
export const BOOKING_PATH = "/book";

/** An artist slug as the API and the storefront check it. */
const ARTIST_SLUG = /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/;
/** A photo's id as the storefront's `artwork` takes it: a lowercase UUID. */
const PHOTO_ID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Discover's referral token as the platform writes it: base64url payload,
 * a dot, base64url signature, at most 512 characters (the intake's limit).
 */
const REFERRAL = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
export const REFERRAL_MAX = 512;

/** Whether `ref` is shaped like a referral token (the platform decides whether it is one). */
export function isReferralShaped(ref: unknown): ref is string {
	return (
		typeof ref === "string" && ref.length <= REFERRAL_MAX && REFERRAL.test(ref)
	);
}

function isLocalHost(hostname: string): boolean {
	return hostname === "localhost" || hostname.endsWith(".localhost");
}

/** A studio-site URL from the API, if it may be linked: https (http on localhost only), no credentials. */
export function safeSiteUrl(value: unknown): URL | null {
	if (typeof value !== "string" || value.length > 2048) return null;
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return null;
	}
	if (url.username || url.password) return null;
	if (url.protocol === "https:") return url;
	if (url.protocol === "http:" && isLocalHost(url.hostname)) return url;
	return null;
}

export type BookingLinks = {
	/** The storefront's request form, with `artist`/`artwork` and `ref` as the API gave them; null: no online booking. */
	request: string | null;
	/** The studio's (or artist's) page on its own site; null when it isn't safe to link. */
	site: string | null;
};

/**
 * A profile's or an artwork's booking links from its API answer. `artist`
 * is the artist profile's own slug (none for a studio), `artwork` the
 * artwork page's own photo id: the request names them only when the API's
 * link names exactly them.
 */
export function bookingLinks(
	profile: { bookingUrl: string; storefrontUrl: string },
	artist?: string,
	artwork?: string,
): BookingLinks {
	const site = safeSiteUrl(profile.storefrontUrl);
	const booking = safeSiteUrl(profile.bookingUrl);
	const valid =
		site !== null &&
		booking !== null &&
		booking.protocol === site.protocol &&
		booking.host === site.host &&
		booking.pathname === BOOKING_PATH;
	let request: string | null = null;
	if (valid) {
		const out = new URL(BOOKING_PATH, booking.origin);
		const named = booking.searchParams.get("artist");
		if (artist && named === artist && ARTIST_SLUG.test(artist))
			out.searchParams.set("artist", artist);
		const piece = booking.searchParams.get("artwork");
		if (artwork && piece === artwork && PHOTO_ID.test(artwork))
			out.searchParams.set("artwork", artwork);
		const ref = booking.searchParams.get("ref");
		if (isReferralShaped(ref)) out.searchParams.set("ref", ref);
		request = out.toString();
	}
	return { request, site: site?.toString() ?? null };
}

/** The same request without an artist: the studio's general form (for an artist who isn't taking requests). */
export function generalRequest(request: string): string {
	const url = new URL(request);
	url.searchParams.delete("artist");
	return url.toString();
}

/** A public social or website link from the API, if it is https (the platform keeps only https). */
export function safeSocialUrl(value: unknown): string | null {
	const url = safeSiteUrl(value);
	return url && url.protocol === "https:" ? url.toString() : null;
}

/** "Instagram", "Facebook", "TikTok", "Website", else the platform's own word. */
export function socialLabel(platform: string): string {
	switch (platform) {
		case "instagram":
			return "Instagram";
		case "facebook":
			return "Facebook";
		case "tiktok":
			return "TikTok";
		case "website":
			return "Website";
		default:
			return platform.charAt(0).toUpperCase() + platform.slice(1);
	}
}
