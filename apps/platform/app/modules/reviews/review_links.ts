import { createHash, createHmac, hkdfSync, randomBytes } from "node:crypto";
import { storefrontTemplate } from "#modules/payments/deposit_links";
import env from "#start/env";

/**
 * Review links (Reviews and Fresh ink, rulings 2 and 4): the bearer link to
 * a project's review page. The security model is the deposit link's
 * (TAT-65): a random nonce per link, the token an HMAC of it with a key of
 * its own (HKDF of APP_KEY, a label of its own, so it never shares a key
 * with deposit links or rate-limit digests), and only the nonce and the
 * token's SHA-256 stored. The studio's "Ask for a review" can show the same
 * link again; rotating APP_KEY kills every link.
 */

/** How long a review link works after it is made (ruling 4). */
export const REVIEW_LINK_MONTHS = 12;

/** A review link's token: 43 base64url characters (256 bits). */
export const REVIEW_TOKEN = /^[A-Za-z0-9_-]{43}$/;

/**
 * The request header the token travels in. Never a path or a query string:
 * the token must not appear in a URL the API sees or logs.
 */
export const REVIEW_TOKEN_HEADER = "x-review-token";

/** A fresh nonce for a link: 16 random bytes in base64url (22 characters). */
export function newReviewNonce(): string {
	return randomBytes(16).toString("base64url");
}

function tokenKey(): Buffer {
	return Buffer.from(
		hkdfSync(
			"sha256",
			env.get("APP_KEY").release(),
			"",
			"tattoo-drip review-link token key v1",
			32,
		),
	);
}

/** A link's token, derived from its nonce: the database never holds it. */
export function reviewTokenFor(nonce: string): string {
	return createHmac("sha256", tokenKey()).update(nonce).digest("base64url");
}

/** What a token is looked up by: its SHA-256 in hex. */
export function hashReviewToken(token: string): string {
	return createHash("sha256").update(token).digest("hex");
}

/**
 * The client's review page for `slug`'s link: the studio page's origin
 * (STOREFRONT_URL with the slug for `{tenant}`), then `/review#<token>`. The
 * token is in the fragment, which browsers never send to a server, its logs
 * or a Referer.
 */
export function reviewPageUrl(
	slug: string,
	token: string,
	template: string = storefrontTemplate(),
): string {
	if (!template.includes("{tenant}")) {
		throw new Error(
			"STOREFRONT_URL must contain {tenant}, e.g. https://{tenant}.example.com",
		);
	}
	const { origin } = new URL(template.replaceAll("{tenant}", slug));
	return `${origin}/review#${token}`;
}

/**
 * The feature flag (spec ruling 12): reviews stay off until the client
 * content terms are reviewed. Off, every public review route is a 404 and
 * no link can be made. Read on every call, so a test can turn it on and off.
 */
export function reviewsEnabled(): boolean {
	return env.get("REVIEWS_ENABLED") === true;
}
