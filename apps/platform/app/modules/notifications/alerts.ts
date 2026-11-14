import { DateTime } from "luxon";
import { firstName } from "#modules/notifications/messages";

/**
 * What a staff alert is about: a new inquiry (TAT-52), a client's deposit
 * screenshot (TAT-88) or a Fresh ink post waiting for approval (Reviews and
 * Fresh ink, slice 2).
 */
export const ALERT_KINDS = [
	"new_inquiry",
	"deposit_proof",
	"fresh_ink",
] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

/**
 * The alert kinds a tab already counts: for an owner the Inbox the new
 * inquiries, Today the screenshots and Reviews the waiting Fresh ink; for an
 * artist Reviews the waiting Fresh ink of their projects.
 */
const OWNER_TAB_COUNTED: readonly AlertKind[] = [
	"new_inquiry",
	"deposit_proof",
	"fresh_ink",
];
const ARTIST_TAB_COUNTED: readonly AlertKind[] = ["fresh_ink"];

/**
 * The unread alert kinds the bell counts for `role` (TAT-107): only what no
 * tab counts, so no number shows twice. An owner's are all on the Inbox,
 * Today and Reviews; an artist's Fresh ink is on Reviews. A new kind counts
 * on the bell until a tab counts it.
 */
export function bellKinds(role: string): AlertKind[] {
	const counted =
		role === "owner"
			? OWNER_TAB_COUNTED
			: role === "artist"
				? ARTIST_TAB_COUNTED
				: [];
	return ALERT_KINDS.filter((kind) => !counted.includes(kind));
}

/** How much of the idea a new-inquiry email quotes, in characters as people count them. */
export const EXCERPT_LENGTH = 140;

/** How much of the idea the Alerts list quotes: about two lines on a phone (TAT-102). */
export const ALERT_EXCERPT_LENGTH = 80;

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

/** A word a name can be made of: letters, marks (Devanagari vowel signs, virama, nukta), ZWNJ/ZWJ, hyphens, apostrophes. */
const NAME_WORD = /^(?:[\p{L}\p{M}'\u2019-]|\u200C|\u200D)+$/u;
const LETTER = /\p{L}/u;

/**
 * The client's first name as an email may print it (TAT-16, abuse-4): the first word when it is
 * made of name characters only, else "A client". A word with a dot, colon, slash, @ or digit is
 * what mail clients turn into a link, and the email comes from our trusted sender.
 */
export function emailName(clientName: string): string {
	const word = firstName(clientName);
	return NAME_WORD.test(word) && LETTER.test(word) ? word : "A client";
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
	const who = emailName(clientName);
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

/**
 * The deposit-proof email's first line (TAT-88): "Sita sent Black Needle a
 * deposit screenshot." and, for the project's artist, "… for your project.".
 */
export function proofIntro({
	clientName,
	studioName,
	yourProject,
}: {
	clientName: string;
	studioName: string;
	yourProject: boolean;
}): string {
	const who = emailName(clientName);
	const whose = yourProject ? " for your project" : "";
	return `${who} sent ${studioName} a deposit screenshot${whose}.`;
}

/** The deposit-proof subject: no client data, because SendMailJob.failed() logs it. */
export function depositProofSubject(studioName: string): string {
	return `Deposit screenshot for ${studioName}`;
}

/**
 * A client's shown name as an email may print it (slice 2): the name the
 * client chose (ruling 9, 1 to 40 characters, any script) when each word is
 * made of name characters, an initial's final dot allowed ("Sita R."), else
 * "A client". A dot inside a word, a colon, a slash, an @ or a digit is what
 * mail clients turn into a link, and the email comes from our sender.
 */
export function emailShownName(shownName: string): string {
	const words = shownName.trim().split(/\s+/u).filter(Boolean);
	const ok =
		words.length > 0 &&
		words.every((word) => {
			const bare = word.endsWith(".") ? word.slice(0, -1) : word;
			return NAME_WORD.test(bare) && LETTER.test(bare);
		});
	return ok ? words.join(" ") : "A client";
}

/**
 * The Fresh ink email's first line (slice 2): "Sita R. sent Black Needle
 * Fresh ink of their healed tattoo." or, for a client's change of an approved
 * post, "Sita R. changed their Fresh ink post for Black Needle."; "for your
 * project" when the member is the project's artist.
 */
export function freshInkIntro({
	shownName,
	studioName,
	edited,
	yourProject,
}: {
	shownName: string;
	studioName: string;
	edited: boolean;
	yourProject: boolean;
}): string {
	const who = emailShownName(shownName);
	const whose = yourProject ? " (your project)" : "";
	return edited
		? `${who} changed their Fresh ink post for ${studioName}${whose}.`
		: `${who} sent ${studioName} Fresh ink of their healed tattoo${whose}.`;
}

/** The Fresh ink subject: no client data, because SendMailJob.failed() logs it. */
export function freshInkSubject(studioName: string): string {
	return `Fresh ink to approve for ${studioName}`;
}

/** The Reviews page on the dashboard: where a Fresh ink alert opens (its waiting posts). */
export function reviewsPath(slug: string): string {
	return `/t/${slug}/reviews`;
}

/** The anchor of the project page's Payments card (inertia/components/payments_card.tsx). */
export const PAYMENTS_CARD = "payments";

/** A project's Payments card on the dashboard: where a deposit-proof alert opens. */
export function paymentsCardPath(slug: string, projectId: string): string {
	return `/t/${slug}/projects/${projectId}#${PAYMENTS_CARD}`;
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
	deposit_proof: {
		owner: {
			title: "Deposit screenshot to check",
			detail: "Open the project's Payments card.",
		},
		other: {
			title: "A deposit screenshot for your project",
			detail: "An owner checks it on the Payments card.",
		},
	},
	fresh_ink: {
		owner: {
			title: "Fresh ink to approve",
			detail: "Open it on the Reviews page.",
		},
		other: {
			title: "Fresh ink to approve",
			detail: "Open it on the Reviews page.",
		},
	},
};

/** The title of a Fresh ink alert about a client's change of an approved post. */
export const FRESH_INK_CHANGED_TITLE = "Fresh ink changed: approve it again";

/**
 * What an alert is about, read when the list is built (TAT-102): a row holds
 * ids only (spec ruling 5), so the names come from the inquiry or project at
 * render time and an old row needs no migration.
 */
export type AlertContent =
	| { kind: "new_inquiry"; clientName: string; idea: string }
	| {
			kind: "fresh_ink";
			/** The name the client chose to show (ruling 9), never their full name. */
			shownName: string;
			/** A client's change of an approved post (a later round). */
			edited: boolean;
	  }
	| {
			kind: "deposit_proof";
			clientName: string;
			/** What the screenshot claims ("NPR 3,000"): owners only, else null. */
			amountText: string | null;
	  };

/**
 * The Alerts list's line for an alert. The title is fixed per kind and role.
 * The detail is "Sita: A koi fish swimming up my calf…" (TAT-102): the
 * client's first name, as the email says it, and the start of the idea
 * (`excerpt`, so a Devanagari syllable is never cut) or, for a deposit
 * screenshot, its amount. Never a phone number. Without `content`, or when
 * the part after the name is unknown (a blank idea, no amount for an
 * owner), the fixed line stays after the name: "Sita: Open it in the
 * inbox.". An artist's deposit alert never has an amount and says whose
 * deposit it is: "Deposit from Sita: an owner checks it on the Payments
 * card." Content of another kind than the alert's is ignored.
 */
export function alertCopy(
	kind: AlertKind,
	isOwner: boolean,
	content?: AlertContent | null,
): AlertLine {
	const line = isOwner ? LINES[kind].owner : LINES[kind].other;
	if (!content || content.kind !== kind) return line;
	if (content.kind === "fresh_ink") {
		return {
			title: content.edited ? FRESH_INK_CHANGED_TITLE : line.title,
			detail: `${content.shownName.trim() || "A client"}: ${line.detail}`,
		};
	}
	const who = firstName(content.clientName) || "A client";
	if (content.kind === "new_inquiry") {
		const idea = excerpt(content.idea, ALERT_EXCERPT_LENGTH);
		return { title: line.title, detail: `${who}: ${idea || line.detail}` };
	}
	if (!isOwner) {
		const note = line.detail.charAt(0).toLowerCase() + line.detail.slice(1);
		return { title: line.title, detail: `Deposit from ${who}: ${note}` };
	}
	return {
		title: line.title,
		detail: `${who}: ${content.amountText ?? line.detail}`,
	};
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

/** Where opening an alert goes: a named route, its id and, for a card, the fragment. */
export type AlertTarget =
	| { route: "tenant.inbox.show"; id: string }
	| { route: "tenant.projects.show"; id: string; hash: typeof PAYMENTS_CARD }
	| { route: "tenant.reviews.index" };

/**
 * Where opening an alert goes (TAT-52 ruling 10, TAT-88 ruling 9): an
 * owner's new-inquiry alert opens its inquiry; a deposit-proof alert opens
 * its project at the Payments card, for any role (the project page applies
 * the member's access); a Fresh ink alert opens the Reviews page. Anything
 * else stays on the list. Computed from the
 * row and the member's current role, never from the request.
 */
export function alertTarget(
	alert: {
		kind: AlertKind;
		inquiryId: string | null;
		projectId?: string | null;
	},
	role: string,
): AlertTarget | null {
	if (alert.kind === "new_inquiry" && alert.inquiryId && role === "owner") {
		return { route: "tenant.inbox.show", id: alert.inquiryId };
	}
	if (alert.kind === "deposit_proof" && alert.projectId) {
		return {
			route: "tenant.projects.show",
			id: alert.projectId,
			hash: PAYMENTS_CARD,
		};
	}
	// Fresh ink opens the Reviews page, whose waiting posts are the member's own (any role).
	if (alert.kind === "fresh_ink") return { route: "tenant.reviews.index" };
	return null;
}
