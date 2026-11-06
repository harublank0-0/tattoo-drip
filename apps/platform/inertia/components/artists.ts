/**
 * An artist as the artists list shows it.
 */
export type ArtistRowProps = {
	id: string;
	name: string;
	/** The photo's 320 px copy (TAT-112), or the photo itself when it has none. */
	photoUrl: string | null;
	visible: boolean;
	acceptingInquiries: boolean;
	/** Linked to the signed-in user. */
	isMine: boolean;
	/** The artist's own public page; null while hidden (TAT-101). */
	pageUrl: string | null;
};

/** A card of the Artists workspace (Studio OS): the row, and what the list adds. */
export type ArtistListRow = ArtistRowProps & {
	/** The artist's styles' names, in the list's order. */
	styleNames: string[];
	/** A member's account is linked to the profile; many artists have none. */
	hasLogin: boolean;
	/** Scheduled sessions in the next `upcomingDays` days. */
	upcomingCount: number;
	/** Work photos in the portfolio, published or not. */
	photoCount: number;
	/** "Sat 8 Nov, 14:00": the first of them; null for none. */
	nextText: string | null;
};

/** The profile's schedule (Studio OS): the next days' sessions and the studio's hours. */
export type ArtistSchedule = {
	days: number;
	sessions: (import("~/components/today").UpcomingSession & {
		whenText: string;
	})[];
	/** The studio's open weekdays, Sunday first ("HH:mm"). */
	hours: { day: string; opens: string; closes: string }[];
};

/** An artist profile as the edit form gets it: the row and what it edits. */
export type ArtistProps = ArtistRowProps & {
	slug: string;
	bio: string | null;
	/** The "Taking flash requests" switch (TAT-129). */
	acceptingFlash: boolean;
	closedMessage: string | null;
	/** The artist's styles that are still on the list, in the list's order. */
	styles: string[];
	instagramUrl: string | null;
	facebookUrl: string | null;
	tiktokUrl: string | null;
};

/**
 * One tattoo style the form offers: the slug is what is sent, the name what
 * people read.
 */
export type StyleOption = { slug: string; name: string };
