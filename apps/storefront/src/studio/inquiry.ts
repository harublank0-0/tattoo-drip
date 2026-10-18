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
	  }
	| { readonly kind: "studio-closed"; readonly studioName: string }
	| {
			readonly kind: "artist-closed";
			readonly studioName: string;
			readonly artistName: string;
			/** Whether a general inquiry (no artist) would be taken. */
			readonly studioOpen: boolean;
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

export function inquiryChannels(
	studio: StudioView,
	artist: InquiryArtist | null,
): InquiryChannels {
	const ask = artist ? `ask ${artist.name}` : "ask";
	const whatsapp = whatsappLink(
		studio.phone,
		`Hi ${studio.name}, I'd like to ${ask} about a tattoo.`,
	);
	const email = mailtoLink(studio.email, {
		subject: artist ? `Tattoo inquiry for ${artist.name}` : "Tattoo inquiry",
		body: `Hi ${studio.name},\r\n\r\nMy idea:\r\nPlacement and size:\r\nPreferred dates:\r\n`,
	});
	const instagram =
		whatsapp || email
			? null
			: (studio.links.find((link) => link.kind === "instagram")?.href ?? null);
	return { whatsapp, email, instagram };
}
