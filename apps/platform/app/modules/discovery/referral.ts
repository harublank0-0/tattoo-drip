import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import env from "#start/env";

/**
 * Discover's booking referral (Discover D03, docs/discover/api.md,
 * "Referral"): a signed note that a booking link was made by Discover for one
 * studio. Discover's booking URLs carry it as `ref`; the storefront hands it
 * to the intake (`referral`), which records the inquiry's referral source
 * only when the token verifies for that studio. Attribution only: it
 * authorises nothing, grants no access and never blocks an inquiry.
 *
 * The token is `<payload>.<signature>`, both base64url: the payload is the
 * JSON of version, purpose, issuer, studio id, issued-at and expiry (whole
 * seconds), and nothing about a person; the signature is HMAC-SHA256 of the
 * payload's text with a key derived from APP_KEY for this purpose alone
 * (rotating APP_KEY invalidates every token, which only drops attribution).
 */
export const REFERRAL_VERSION = 1;
export const REFERRAL_PURPOSE = "booking_referral";
export const REFERRAL_ISSUER = "discover";
/** How long a link keeps its attribution. */
export const REFERRAL_TTL_SECONDS = 30 * 24 * 60 * 60;
/** Far above a real token (about 200 characters): anything longer is not one. */
export const MAX_REFERRAL_LENGTH = 512;
/** A small allowance for clocks a little ahead of this one. */
const CLOCK_SKEW_SECONDS = 300;

type Payload = {
	v: number;
	p: string;
	iss: string;
	sid: string;
	iat: number;
	exp: number;
};

export type ReferralCheck =
	| { valid: true; issuedAt: Date }
	| {
			valid: false;
			reason:
				| "missing"
				| "malformed"
				| "signature"
				| "version"
				| "purpose"
				| "expired"
				| "not_yet_valid"
				| "studio";
	  };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PART = /^[A-Za-z0-9_-]+$/;

function referralKey(): Buffer {
	return Buffer.from(
		hkdfSync(
			"sha256",
			env.get("APP_KEY").release(),
			"",
			"tattoo-drip discover referral token key v1",
			32,
		),
	);
}

function sign(payload: string): Buffer {
	return createHmac("sha256", referralKey()).update(payload).digest();
}

/** A referral token for a booking link to `studioId`, issued at `now`. */
export function signReferral(studioId: string, now = new Date()): string {
	const iat = Math.floor(now.getTime() / 1000);
	const payload: Payload = {
		v: REFERRAL_VERSION,
		p: REFERRAL_PURPOSE,
		iss: REFERRAL_ISSUER,
		sid: studioId,
		iat,
		exp: iat + REFERRAL_TTL_SECONDS,
	};
	const text = Buffer.from(JSON.stringify(payload)).toString("base64url");
	return `${text}.${sign(text).toString("base64url")}`;
}

/**
 * Booking links sign with the start of the hour, not the second: a profile's
 * body, and so its ETag, then stays the same for the hour and a cache's
 * revalidation gets a 304 instead of a fresh body every second. A link
 * therefore keeps its attribution for 29 to 30 days.
 */
export const REFERRAL_LINK_STEP_SECONDS = 60 * 60;

/** The referral token Discover puts on a booking link to `studioId` at `now`. */
export function linkReferral(studioId: string, now = new Date()): string {
	const step = REFERRAL_LINK_STEP_SECONDS * 1000;
	return signReferral(
		studioId,
		new Date(Math.floor(now.getTime() / step) * step),
	);
}

/**
 * Whether `token` (anything a client sent) is a live referral for
 * `studioId`. Never throws: every failure is a reason, which callers only
 * use to drop the attribution.
 */
export function verifyReferral(
	token: unknown,
	studioId: string,
	now = new Date(),
): ReferralCheck {
	if (token === undefined || token === null || token === "") {
		return { valid: false, reason: "missing" };
	}
	if (typeof token !== "string" || token.length > MAX_REFERRAL_LENGTH) {
		return { valid: false, reason: "malformed" };
	}
	const parts = token.split(".");
	if (parts.length !== 2 || !parts.every((part) => PART.test(part))) {
		return { valid: false, reason: "malformed" };
	}
	const [text, signature] = parts;
	const given = Buffer.from(signature, "base64url");
	const expected = sign(text);
	// The signature first, in constant time, before the payload is trusted.
	if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
		return { valid: false, reason: "signature" };
	}
	// One spelling only: base64url ignores the last character's spare bits.
	if (expected.toString("base64url") !== signature) {
		return { valid: false, reason: "malformed" };
	}
	let payload: Partial<Payload>;
	try {
		payload = JSON.parse(Buffer.from(text, "base64url").toString("utf8"));
	} catch {
		return { valid: false, reason: "malformed" };
	}
	if (typeof payload !== "object" || payload === null) {
		return { valid: false, reason: "malformed" };
	}
	if (payload.v !== REFERRAL_VERSION)
		return { valid: false, reason: "version" };
	if (payload.p !== REFERRAL_PURPOSE || payload.iss !== REFERRAL_ISSUER) {
		return { valid: false, reason: "purpose" };
	}
	const { iat, exp, sid } = payload;
	if (
		!Number.isInteger(iat) ||
		!Number.isInteger(exp) ||
		typeof sid !== "string" ||
		!UUID.test(sid)
	) {
		return { valid: false, reason: "malformed" };
	}
	const seconds = Math.floor(now.getTime() / 1000);
	if ((iat as number) > seconds + CLOCK_SKEW_SECONDS) {
		return { valid: false, reason: "not_yet_valid" };
	}
	if ((exp as number) <= seconds) return { valid: false, reason: "expired" };
	if (sid !== studioId) return { valid: false, reason: "studio" };
	return { valid: true, issuedAt: new Date((iat as number) * 1000) };
}
