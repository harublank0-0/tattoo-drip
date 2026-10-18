import { DateTime } from "luxon";
import { firstName } from "#modules/notifications/messages";

/** What a staff alert is about (TAT-52). The deposit-proof alert is a follow-up (spec ruling 12). */
export const ALERT_KINDS = ["new_inquiry"] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

/** How much of the idea a new-inquiry email quotes, in characters as people count them. */
export const EXCERPT_LENGTH = 140;

const GRAPHEMES = new Intl.Segmenter("en", { granularity: "grapheme" });

/**
 * The start of `text` for an email (spec ruling 5): whitespace collapsed,
 * at most `max` graphemes (never half a Devanagari syllable or an emoji),
 * cut at a word when one ends in the second half, then "…".
 */
export function excerpt(text: string, max: number = EXCERPT_LENGTH): string {
	const flat = text.replace(/\s+/g, " ").trim();
	const parts = Array.from(GRAPHEMES.segment(flat), ({ segment }) => segment);
	if (parts.length <= max) return flat;
	const cut = parts.slice(0, max).join("");
	const space = cut.lastIndexOf(" ");
	const kept = space > cut.length / 2 ? cut.slice(0, space) : cut;
	return `${kept.trimEnd()}…`;
}

/** A member an alert can reach: TenancyService.members' shape. */
export type AlertMember = {
	userId: string;
	role: string;
	email: string;
	fullName: string | null;
};

/** A recipient, and whether the client asked for them. */
export type AlertRecipient = AlertMember & { askedForYou: boolean };

/**
 * Who hears about a new inquiry (spec ruling 3): every owner, then the
 * member linked to the inquiry's live preferred artist when they aren't an
 * owner; each once. `preferredUserId` is that artist's user, or null.
 */
export function inquiryRecipients(
	members: readonly AlertMember[],
	preferredUserId: string | null,
): AlertRecipient[] {
	const asked = (member: AlertMember) =>
		preferredUserId !== null && member.userId === preferredUserId;
	const owners = members.filter(({ role }) => role === "owner");
	const preferred = members.find(
		(member) => asked(member) && member.role !== "owner",
	);
	return [...owners, ...(preferred ? [preferred] : [])].map((member) => ({
		...member,
		askedForYou: asked(member),
	}));
}

/** The email's first line: "Sita sent Black Needle a new tattoo inquiry and asked for you:". */
export function inquiryIntro({
	clientName,
	studioName,
	artistName,
	askedForYou,
}: {
	clientName: string;
	studioName: string;
	artistName: string | null;
	askedForYou: boolean;
}): string {
	const who = firstName(clientName) || "A client";
	let asked = "";
	if (askedForYou) asked = " and asked for you";
	else if (artistName) asked = ` and asked for ${artistName}`;
	return `${who} sent ${studioName} a new tattoo inquiry${asked}:`;
}

/** The subject: no client data, because SendMailJob.failed() logs it. */
export function newInquirySubject(studioName: string): string {
	return `New inquiry for ${studioName}`;
}

/** An absolute dashboard address for an email: `path` on `appUrl` (APP_URL). */
export function dashboardUrl(appUrl: string, path: string): string {
	return new URL(path, appUrl).toString();
}

type AlertLine = { title: string; detail: string };

const LINES: Record<AlertKind, { owner: AlertLine; other: AlertLine }> = {
	new_inquiry: {
		owner: { title: "New inquiry", detail: "Open it in the inbox." },
		other: {
			title: "A new inquiry asks for you",
			detail: "An owner reviews it in the inbox.",
		},
	},
};

/** The Alerts list's line for an alert. No client data: a row holds ids only (spec ruling 5). */
export function alertCopy(kind: AlertKind, isOwner: boolean): AlertLine {
	return isOwner ? LINES[kind].owner : LINES[kind].other;
}

/**
 * When an alert came, in the studio's timezone: "Today, 14:05",
 * "Yesterday, 09:12", "12 Oct, 09:12", "12 Oct 2025, 09:12".
 */
export function alertTimeText(
	at: DateTime,
	timezone: string,
	now: DateTime = DateTime.now(),
): string {
	const local = at.setZone(timezone).setLocale("en-GB");
	const today = now.setZone(timezone);
	const time = local.toFormat("HH:mm");
	if (local.hasSame(today, "day")) return `Today, ${time}`;
	if (local.hasSame(today.minus({ days: 1 }), "day")) {
		return `Yesterday, ${time}`;
	}
	if (local.hasSame(today, "year"))
		return `${local.toFormat("d LLL")}, ${time}`;
	return `${local.toFormat("d LLL yyyy")}, ${time}`;
}

/**
 * Where opening an alert goes (spec ruling 10): an owner's new-inquiry
 * alert opens its inquiry; anything else stays on the list. Computed from
 * the row and the member's current role, never from the request.
 */
export function alertTarget(
	alert: { kind: AlertKind; inquiryId: string | null },
	role: string,
): { route: "tenant.inbox.show"; id: string } | null {
	if (alert.kind === "new_inquiry" && alert.inquiryId && role === "owner") {
		return { route: "tenant.inbox.show", id: alert.inquiryId };
	}
	return null;
}
