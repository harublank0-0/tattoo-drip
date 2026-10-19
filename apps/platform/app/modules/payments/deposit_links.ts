import {
	createHash,
	createHmac,
	hkdfSync,
	randomBytes,
	randomInt,
} from "node:crypto";
import {
	DEFAULT_TEMPLATES,
	firstName,
	renderMessage,
} from "#modules/notifications/messages";
import type { DepositLinkRuleReason } from "#modules/payments/errors";
import env from "#start/env";

/** How long a deposit link works after it is made or replaced (TAT-65). */
export const DEPOSIT_LINK_DAYS = 30;

/**
 * A deposit link's token: 43 base64url characters (256 bits). The deposit
 * routes match it, so anything else never reaches a query.
 */
export const DEPOSIT_TOKEN = /^[A-Za-z0-9_-]{43}$/;

/**
 * The reference code's symbols: digits and capitals that can't be misread
 * when typed into a payment remark (no 0, 1, I, L, O or U).
 */
export const REFERENCE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
export const REFERENCE_LENGTH = 6;

/** Where deposit links point without STOREFRONT_URL: TAT-12's dev host. */
export const DEV_STOREFRONT_URL = "http://{tenant}.localhost:3000";

/** A fresh nonce for a link: 16 random bytes in base64url (22 characters). */
export function newTokenNonce(): string {
	return randomBytes(16).toString("base64url");
}

/**
 * The key tokens are derived with: HKDF of APP_KEY with a label of its own,
 * so tokenFor never shares the raw APP_KEY with `digest()` (rate-limit keys)
 * or anything else that HMACs with it. Rotating APP_KEY changes it.
 */
function tokenKey(): Buffer {
	return Buffer.from(
		hkdfSync(
			"sha256",
			env.get("APP_KEY").release(),
			"",
			"tattoo-drip deposit-link token key v1",
			32,
		),
	);
}

/**
 * A link's token, derived from its nonce with a key made from APP_KEY, so
 * the owner's page can show the link again at any time while the database
 * holds no token. Rotating APP_KEY changes every token: the nonce no longer
 * derives the stored hash (DepositLinkService.liveToken) and every link
 * stops working.
 */
export function tokenFor(nonce: string): string {
	return createHmac("sha256", tokenKey()).update(nonce).digest("base64url");
}

/** What a token is looked up by: its SHA-256 in hex. */
export function hashToken(token: string): string {
	return createHash("sha256").update(token).digest("hex");
}

/** A random reference code: REFERENCE_LENGTH symbols of REFERENCE_ALPHABET. */
export function newReferenceCode(): string {
	let code = "";
	for (let i = 0; i < REFERENCE_LENGTH; i++) {
		code += REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)];
	}
	return code;
}

/** The template deposit links are built from: STOREFRONT_URL, else the dev host. */
export function storefrontTemplate(): string {
	return env.get("STOREFRONT_URL") ?? DEV_STOREFRONT_URL;
}

/**
 * The public deposit page of `slug`'s link: the origin of `template`
 * (STOREFRONT_URL) with the slug for `{tenant}`, then `/deposit#<token>`.
 * The token is in the fragment, which browsers never send to the
 * storefront's host, its logs or a Referer.
 */
export function depositPageUrl(
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
	return `${origin}/deposit#${token}`;
}

export type DepositMessageInput = {
	clientName: string;
	studioName: string;
	dueText: string;
	referenceCode: string;
	url: string;
};

/**
 * The deposit link as a chat message to the client: the studio's own text
 * (`template`, which must keep {deposit_link}; TAT-52), or the default,
 * TAT-65's original message with the link last and on its own line so
 * every chat app makes it tappable.
 */
export function depositMessage(
	{ clientName, studioName, dueText, referenceCode, url }: DepositMessageInput,
	template: string = DEFAULT_TEMPLATES.deposit_link,
): string {
	return renderMessage("deposit_link", template, {
		client_name: firstName(clientName),
		studio_name: studioName,
		amount: dueText,
		reference_code: referenceCode,
		deposit_link: url,
	});
}

/** Why an owner can't make a deposit link now: the project page and its flash say it. */
export const DEPOSIT_LINK_PROBLEMS: Record<DepositLinkRuleReason, string> = {
	not_deposit_pending:
		"A deposit link can only be made while the project waits for its deposit.",
	quote_expired: "The quote has expired: revise it first.",
	nothing_due: "Nothing is left to pay on this deposit.",
	no_payment_methods:
		"Show a payment method on the deposit page first (Settings, Payments).",
};
