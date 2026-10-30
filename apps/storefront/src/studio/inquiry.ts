import { fill } from "../intake/template.ts";
import { studioCopy } from "./copy.ts";
import type { FlashDesignView } from "./flash.ts";
import { mailtoLink, whatsappLink } from "./links.ts";
import type { ArtistView, StudioView } from "./view-model.ts";

/**
 * The #inquiry section's state (TAT-48): the contract TAT-57's intake form
 * fills. `open` is where the form goes: it sends `preferredArtist.id` as
 * createInquiry's `preferredArtistId` and lets the client choose only among
 * `artists` (the visible ones taking inquiries, by name).
 */

/** An artist an inquiry can ask for. */
export interface InquiryArtist {
	readonly id: string;
	readonly name: string;
}

export type InquiryState =
	| {
			readonly kind: "open";
			readonly studioName: string;
			readonly preferredArtist: InquiryArtist | null;
			readonly artists: readonly InquiryArtist[];
			/**
			 * What a flash request starts with (TAT-129): the idea and the size,
			 * filled in and still editable. Absent for a custom request.
			 */
			readonly start?: {
				readonly idea: string;
				readonly approximateSize: string;
			};
			/** The flash design the request asks for (sent as `flashDesignId`); absent for a custom request. */
			readonly flashDesignId?: string;
	  }
	| { readonly kind: "studio-closed"; readonly studioName: string }
	| {
			readonly kind: "artist-closed";
			readonly studioName: string;
			readonly artistName: string;
			/** Whether a general inquiry (no artist) would be taken. */
			readonly studioOpen: boolean;
			/** What the artist said about being closed, or null. */
			readonly closedMessage: string | null;
	  };

/** How an open inquiry is sent until TAT-57's form exists. */
export interface InquiryChannels {
	/** WhatsApp with a prefilled message. */
	readonly whatsapp: string | null;
	/** An email with a prefilled subject and body. */
	readonly email: string | null;
	/** The studio's Instagram, only when it has neither phone nor email. */
	readonly instagram: string | null;
}

/**
 * The studio page (`selected` null) goes by the studio's flag; an artist's
 * page by that artist's own flag, which is what intake checks for an
 * inquiry naming them.
 */
export function inquiryState(
	studio: StudioView,
	artists: readonly ArtistView[],
	selected: ArtistView | null,
): InquiryState {
	const open = artists
		.filter((artist) => artist.accepting)
		.map(({ id, name }) => ({ id, name }));
	if (selected) {
		return selected.accepting
			? {
					kind: "open",
					studioName: studio.name,
					preferredArtist: { id: selected.id, name: selected.name },
					artists: open,
				}
			: {
					kind: "artist-closed",
					studioName: studio.name,
					artistName: selected.name,
					studioOpen: studio.accepting,
					closedMessage: selected.closedMessage,
				};
	}
	return studio.accepting
		? {
				kind: "open",
				studioName: studio.name,
				preferredArtist: null,
				artists: open,
			}
		: { kind: "studio-closed", studioName: studio.name };
}

/**
 * A request for a flash design (TAT-129): open for the design's artist alone,
 * whatever their books say (the design is judged by their flash switch), with
 * the idea ("The Moth flash") and the size filled in, and the design's id for
 * `flashDesignId`. The loader calls it only for a requestable design.
 */
export function flashInquiryState(
	studio: StudioView,
	design: FlashDesignView,
	artist: ArtistView,
): InquiryState {
	const asked = { id: artist.id, name: artist.name };
	return {
		kind: "open",
		studioName: studio.name,
		preferredArtist: asked,
		artists: [asked],
		start: {
			idea: fill(studioCopy.flash.ideaStart, { name: design.name }),
			approximateSize: design.size,
		},
		flashDesignId: design.id,
	};
}

/**
 * A request for something similar to a claimed design (part 4b): not a flash
 * request (no `flashDesignId`: the design is taken). While the design's artist
 * takes new work it is open for them, with the idea ("Something similar to the
 * Moth flash") and the size started; otherwise it is the artist's own state
 * (`inquiryState`: their closed words, and the studio's general request when
 * the studio still takes work). `artists` is the studio's whole list.
 */
export function similarInquiryState(
	studio: StudioView,
	design: FlashDesignView,
	artist: ArtistView,
	artists: readonly ArtistView[],
): InquiryState {
	const state = inquiryState(studio, artists, artist);
	if (state.kind !== "open") return state;
	return {
		...state,
		start: {
			idea: fill(studioCopy.flash.similarStart, { name: design.name }),
			approximateSize: design.size,
		},
	};
}

/**
 * The fallback's chat and email, prefilled. With a `flashName` (TAT-129) they
 * ask about that flash design.
 */
export function inquiryChannels(
	studio: StudioView,
	artist: InquiryArtist | null,
	flashName: string | null = null,
): InquiryChannels {
	const ask = artist ? `ask ${artist.name}` : "ask";
	const whatsapp = whatsappLink(
		studio.phone,
		flashName
			? `Hi ${studio.name}, I'd like to ask about the ${flashName} flash.`
			: `Hi ${studio.name}, I'd like to ${ask} about a tattoo.`,
	);
	const email = mailtoLink(studio.email, {
		subject: flashName
			? `Flash request: ${flashName}`
			: artist
				? `Tattoo inquiry for ${artist.name}`
				: "Tattoo inquiry",
		body: `Hi ${studio.name},\r\n\r\nMy idea:\r\nPlacement and size:\r\nPreferred dates:\r\n`,
	});
	const instagram =
		whatsapp || email
			? null
			: (studio.links.find((link) => link.kind === "instagram")?.href ?? null);
	return { whatsapp, email, instagram };
}
