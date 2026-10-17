/** What the booking page knows about the number typed in step 1 (TAT-43). */
export type BookingLookup =
	| null
	| { state: "invalid"; typed: string; message: string }
	| { state: "found"; phone: string; client: { id: string; name: string } }
	| { state: "new"; phone: string };

export type BookingPageProps = {
	lookup: BookingLookup;
	/** Who this member may book: every live artist for an owner, their own profile for an artist. */
	artists: { id: string; name: string }[];
	isOwner: boolean;
	/**
	 * yyyy-MM-dd in the studio's timezone: the first and last bookable day,
	 * and the Date field's default (`?date=` when it is bookable, as the
	 * calendar sends it; else today).
	 */
	dates: { today: string; max: string; initial: string };
};
