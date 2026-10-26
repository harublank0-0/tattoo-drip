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
	/** Linked to the signed-in user. */
	isMine: boolean;
	/** The artist's own public page; null while hidden (TAT-101). */
	pageUrl: string | null;
};
