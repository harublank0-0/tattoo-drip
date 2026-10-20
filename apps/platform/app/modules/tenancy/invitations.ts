import type { DateTime } from "luxon";
import type { MembershipRole } from "#modules/tenancy/models/tenant_membership";

/**
 * Invitations to join a studio (TAT-33). The token is TAT-18's
 * (newAccountToken, hashAccountToken, ACCOUNT_TOKEN in
 * #modules/identity/account_tokens); these are the invitation's own pieces.
 */

/** How long an invitation link works, by the database's clock. */
export const INVITATION_DAYS = 7;

/** The one-time flash that carries a new link to the Members page. */
export const INVITATION_LINK_FLASH = "invitationLink";

/** A new link as the Members page shows it, once. */
export type NewInvitationLink = {
	email: string;
	url: string;
	message: string;
	whatsappUrl: string;
	expiresText: string;
};

/** A role in a sentence: "join as an artist". */
export const ROLE_WORDS: Record<MembershipRole, string> = {
	owner: "an owner",
	artist: "an artist",
};

export function invitationPath(token: string): string {
	return `/invitations/${token}`;
}

/** The absolute link the owner sends: the platform's origin plus the path. */
export function invitationUrl(appUrl: string, token: string): string {
	return new URL(invitationPath(token), appUrl).toString();
}

/** The chat message that carries the link. Plain text. */
export function inviteMessage(studioName: string, url: string): string {
	return `You're invited to join ${studioName} on Tattoo Drip. Open this link to accept: ${url}`;
}

/**
 * WhatsApp's share link: it opens WhatsApp with the text and lets the owner
 * pick the chat (no number: the invitee's isn't stored).
 */
export function whatsappShareUrl(text: string): string {
	return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/** When a link stops working, for people, in the studio's timezone: "27 Oct 2026, 14:05". */
export function expiryText(expiresAt: DateTime, timezone: string): string {
	return expiresAt
		.setZone(timezone)
		.setLocale("en-GB")
		.toFormat("d LLL yyyy, HH:mm");
}

/** Whether a value read back from the session is a NewInvitationLink. */
export function isNewInvitationLink(
	value: unknown,
): value is NewInvitationLink {
	if (typeof value !== "object" || value === null) return false;
	const fields = value as Record<string, unknown>;
	return ["email", "url", "message", "whatsappUrl", "expiresText"].every(
		(key) => typeof fields[key] === "string",
	);
}
