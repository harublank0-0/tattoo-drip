import { createHash, randomBytes } from "node:crypto";

/**
 * Single-use account links (TAT-18): one to confirm an email address, one
 * to choose a new password. One kind of token serves both; its purpose is
 * stored with it, so one can never be used as the other.
 */
export const TOKEN_PURPOSES = ["verify_email", "reset_password"] as const;
export type TokenPurpose = (typeof TOKEN_PURPOSES)[number];

/** How long a link works after it is sent; the database's clock decides. */
export const TOKEN_MINUTES: Record<TokenPurpose, number> = {
	verify_email: 24 * 60,
	reset_password: 60,
};

/**
 * A token: 32 random bytes in base64url, 43 characters (256 bits). The link
 * routes match exactly this, so anything else is the router's 404 with no
 * query.
 */
export const ACCOUNT_TOKEN = /^[A-Za-z0-9_-]{43}$/;

/**
 * Where a link's GET puts its token, so the page the person then sees has
 * no token in its URL (spec ruling 5).
 */
export const SESSION_TOKEN_KEYS: Record<TokenPurpose, string> = {
	verify_email: "verify_email_token",
	reset_password: "reset_password_token",
};

/**
 * The flow id (TAT-18): the id of a token's row, which is not a secret. A
 * link's page renders it in a hidden `flow` field, and the POST must send
 * back the id of the token it staged, so a form can only act on the link it
 * showed (not on another one staged in the same session since, in another
 * tab). It never appears in a URL.
 */
export const FLOW_FIELD = "flow";
const FLOW_ID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isFlowId(value: unknown): value is string {
	return typeof value === "string" && FLOW_ID.test(value);
}

/**
 * An invitation form's flow id (TAT-33): a UUID-shaped fingerprint of the
 * stored token hash. It is not the row's id, because replacing or renewing
 * an invitation keeps the row (and its id) but changes the hash, and the
 * form must be tied to the terms it showed: an old tab's form, sent with the
 * session's newer token, would otherwise accept a replacement's other role
 * or profile. Derived with its own prefix, so the stored hash (the lookup
 * key) is not the value the page renders.
 */
export function invitationFlowId(tokenHash: string): string {
	const hex = createHash("sha256")
		.update(`invitation-flow:${tokenHash}`)
		.digest("hex");
	return [
		hex.slice(0, 8),
		hex.slice(8, 12),
		hex.slice(12, 16),
		hex.slice(16, 20),
		hex.slice(20, 32),
	].join("-");
}

/**
 * Where an invitation link's GET puts its token (TAT-33), like the account
 * links' keys above: the invitation page's URL then holds no token.
 */
export const INVITATION_TOKEN_KEY = "invitation_token";

/**
 * Drops every staged link token from a session: the account links and an
 * invitation (TAT-33). Sign-in and sign-out call it: regenerating the
 * session id keeps its data, so without this a link opened before a
 * sign-out would still open its page for the next visitor of a shared
 * browser.
 */
export function forgetStagedTokens(session: { forget(key: string): void }) {
	for (const key of Object.values(SESSION_TOKEN_KEYS)) session.forget(key);
	session.forget(INVITATION_TOKEN_KEY);
}

/** The flash that carries the typed address to the "Check your email" page. */
export const SENT_TO_FLASH = "sentTo";

/** The flash that carries a just-confirmed address to the confirmation page. */
export const CONFIRMED_FLASH = "emailConfirmed";

export function newAccountToken(): string {
	return randomBytes(32).toString("base64url");
}

/**
 * What is stored and looked up: the token's SHA-256 in hex. The token itself
 * is never stored, and matching a digest of 256 random bits through an index
 * leaks nothing usable (spec ruling 3).
 */
export function hashAccountToken(token: string): string {
	return createHash("sha256").update(token).digest("hex");
}

/** The path a token's email links to. */
export function linkPath(purpose: TokenPurpose, token: string): string {
	return purpose === "verify_email"
		? `/verify-email/${token}`
		: `/reset-password/${token}`;
}

/** An absolute link for an email: the platform's origin plus a path. */
export function accountUrl(appUrl: string, path: string): string {
	return new URL(path, appUrl).toString();
}
