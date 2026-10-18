import { firstName, type MessageValues } from "#modules/notifications/messages";
import type { ProjectStatus } from "#modules/projects/models/tattoo_project";

/**
 * The messages the project page's "Message the client" card offers
 * (TAT-52). The quote and the deposit link have their own cards (TAT-64,
 * TAT-65), so they are not here.
 */
export const CARD_KINDS = [
	"inquiry_received",
	"booking_confirmation",
	"session_reminder",
	"aftercare",
] as const;
export type CardKind = (typeof CARD_KINDS)[number];

const CLOSED: readonly ProjectStatus[] = ["declined", "cancelled"];

/** What the card needs to know about the project. */
export type CardState = {
	status: ProjectStatus;
	/** A scheduled session that hasn't started yet. */
	upcomingSession: boolean;
	/** A completed tattoo or touch-up session. */
	finishedWork: boolean;
};

/** The card's messages now, in lifecycle order (spec ruling 16). */
export function cardKinds({
	status,
	upcomingSession,
	finishedWork,
}: CardState): CardKind[] {
	if (CLOSED.includes(status)) return [];
	const kinds: CardKind[] = [];
	if (status === "reviewing") kinds.push("inquiry_received");
	if (upcomingSession) kinds.push("booking_confirmation", "session_reminder");
	if (finishedWork) kinds.push("aftercare");
	return kinds;
}

/** The message the card starts on (spec ruling 25), or null when it offers none. */
export function defaultCardKind(
	status: ProjectStatus,
	kinds: readonly CardKind[],
): CardKind | null {
	let order: CardKind[] = [
		"aftercare",
		"session_reminder",
		"booking_confirmation",
		"inquiry_received",
	];
	if (status === "reviewing") {
		order = [
			"inquiry_received",
			"booking_confirmation",
			"session_reminder",
			"aftercare",
		];
	} else if (status === "booked") {
		order = [
			"booking_confirmation",
			"session_reminder",
			"aftercare",
			"inquiry_received",
		];
	}
	return order.find((kind) => kinds.includes(kind)) ?? null;
}

/** Who the card's messages are about. */
export type CardFacts = {
	clientName: string;
	studioName: string;
	studioAddress: string | null;
	/** The project's artist, for aftercare; null without one. */
	projectArtistName: string | null;
	/** The next session's time text and artist, for the confirmation and the reminder. */
	session: { whenText: string; artistName: string | null } | null;
};

/** Who a message names when it has no artist to name. */
export const ANY_ARTIST = "your artist";

/** The placeholder values of one card message (spec ruling 18). */
export function cardValues(kind: CardKind, facts: CardFacts): MessageValues {
	const base = {
		client_name: firstName(facts.clientName),
		studio_name: facts.studioName,
	};
	if (kind === "inquiry_received") return base;
	if (kind === "aftercare") {
		return { ...base, artist_name: facts.projectArtistName ?? ANY_ARTIST };
	}
	return {
		...base,
		artist_name: facts.session?.artistName ?? ANY_ARTIST,
		session_time: facts.session?.whenText ?? "",
		studio_address: facts.studioAddress ?? "",
	};
}
