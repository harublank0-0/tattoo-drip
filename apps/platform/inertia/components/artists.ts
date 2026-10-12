/**
 * An artist profile as the artists pages get it.
 */
export type ArtistProps = {
	id: string;
	name: string;
	slug: string;
	bio: string | null;
	photoUrl: string | null;
	visible: boolean;
	acceptingInquiries: boolean;
	closedMessage: string | null;
	/** Linked to the signed-in user. */
	isMine: boolean;
};
