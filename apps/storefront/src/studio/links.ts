/**
 * The links the studio page builds (TAT-48). Pure. Only these ever reach an
 * href: the page's own paths and fragments, https: (from the API, parsed
 * again here), tel:, mailto: and viber://chat. The chat links copy the
 * platform's chatLinks() (apps/platform/app/modules/clients/contact_links.ts),
 * which the storefront may not import.
 */

import type { PortfolioSearch, WorkSearch } from "./gallery.ts";

/** E.164, as the platform stores contact phones (TAT-26). */
const E164 = /^\+[1-9]\d{6,14}$/;

/**
 * A conservative email shape: no spaces, quotes, brackets, "?", "#", "&",
 * "%", ":" or "/" (nothing that could add a header or change the scheme),
 * and a dotted domain.
 */
const EMAIL = /^[^\s@"<>()[\]\\,;:?#&%/]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;

const MAX_EMAIL_LENGTH = 254;
const MAX_URL_LENGTH = 2048;

/** What the page may put in an href. */
const ALLOWED_HREF =
	/^(?:\/(?![/\\])|\/$|#|https:\/\/|tel:\+|mailto:|viber:\/\/chat\?)/;

export function isPhone(value: unknown): value is string {
	return typeof value === "string" && E164.test(value);
}

export function isEmail(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length <= MAX_EMAIL_LENGTH &&
		EMAIL.test(value)
	);
}

/** A WhatsApp chat with `phone`; `text` prefills the message. */
export function whatsappLink(
	phone: string | null | undefined,
	text?: string,
): string | null {
	if (!isPhone(phone)) return null;
	const digits = phone.slice(1);
	return text === undefined
		? `https://wa.me/${digits}`
		: `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

/** A Viber chat with `phone` (Viber's link takes no message). */
export function viberLink(phone: string | null | undefined): string | null {
	return isPhone(phone) ? `viber://chat?number=%2B${phone.slice(1)}` : null;
}

/** A call to `phone`. */
export function telLink(phone: string | null | undefined): string | null {
	return isPhone(phone) ? `tel:+${phone.slice(1)}` : null;
}

/** An email to `email`, with an optional prefilled subject and body. */
export function mailtoLink(
	email: string | null | undefined,
	message?: { subject: string; body: string },
): string | null {
	if (!isEmail(email)) return null;
	if (!message) return `mailto:${email}`;
	return `mailto:${email}?subject=${encodeURIComponent(message.subject)}&body=${encodeURIComponent(message.body)}`;
}

/** A Google Maps search for `query` (no key, no embed). */
export function mapsLink(query: string): string {
	return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/** An https URL without credentials, normalized, or null. */
export function safeHttpsUrl(value: unknown): string | null {
	const url = parseUrl(value);
	return url?.protocol === "https:" ? url.href : null;
}

/** An http(s) image URL without credentials, normalized, or null. */
export function safeImageUrl(value: unknown): string | null {
	const url = parseUrl(value);
	return url && (url.protocol === "https:" || url.protocol === "http:")
		? url.href
		: null;
}

/** The host a link goes to, without "www.": the label of an unknown platform. */
export function linkHostname(href: string): string {
	return new URL(href).hostname.replace(/^www\./, "");
}

/**
 * The All work page with these filters (TAT-126): `artist`, `style`,
 * `healed=1` and `cursor`, in that order, absent ones left out. The filters
 * are checked values (readWorkSearch), but each is encoded anyway.
 */
export function workHref(search: WorkSearch): string {
	return `/work${queryOf([
		["artist", search.artist],
		["style", search.style],
		["healed", search.healed ? "1" : undefined],
		["cursor", search.cursor],
	])}`;
}

/**
 * An artist's portfolio (TAT-126): their page, `healed=1` and `cursor` when
 * set, and the Work section's fragment, so a page of photos opens on the
 * photos and not on the profile above them.
 */
export function portfolioHref(slug: string, search: PortfolioSearch): string {
	return `/artists/${slug}${queryOf([
		["healed", search.healed ? "1" : undefined],
		["cursor", search.cursor],
	])}#work`;
}

/** "?a=1&b=2" from the pairs that have a value, else "". */
function queryOf(
	pairs: readonly (readonly [key: string, value: string | undefined])[],
): string {
	const set = pairs.flatMap(([key, value]) =>
		value === undefined ? [] : [`${key}=${encodeURIComponent(value)}`],
	);
	return set.length === 0 ? "" : `?${set.join("&")}`;
}

/** Web links never tell the next site which page sent the visitor. */
export function linkRel(href: string): string | undefined {
	return /^https?:\/\//i.test(href) ? "noopener noreferrer" : undefined;
}

/** Whether the page may render `href` (the components check every link). */
export function isAllowedHref(href: string): boolean {
	return ALLOWED_HREF.test(href);
}

function parseUrl(value: unknown): URL | undefined {
	if (
		typeof value !== "string" ||
		value.length > MAX_URL_LENGTH ||
		value !== value.trim()
	) {
		return undefined;
	}
	try {
		const url = new URL(value);
		return url.username || url.password || !url.hostname ? undefined : url;
	} catch {
		return undefined;
	}
}
