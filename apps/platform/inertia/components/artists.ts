/**
 * An artist profile as the artists pages get it.
 */
export type ArtistProps = {
	id: string;
	name: string;
	slug: string;
	bio: string | null;
	/** The photo's 320 px copy (TAT-112), or the photo itself when it has none. */
	photoUrl: string | null;
	visible: boolean;
	acceptingInquiries: boolean;
	closedMessage: string | null;
	/** The artist's styles that are still on the list, in the list's order. */
	styles: string[];
	instagramUrl: string | null;
	facebookUrl: string | null;
	tiktokUrl: string | null;
	/** Linked to the signed-in user. */
	isMine: boolean;
	/** The artist's own public page; null while hidden (TAT-101). */
	pageUrl: string | null;
};

/**
 * One tattoo style the form offers: the slug is what is sent, the name what
 * people read.
 */
export type StyleOption = { slug: string; name: string };
