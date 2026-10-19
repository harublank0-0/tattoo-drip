import type Artist from "#modules/artists/models/artist";

/**
 * Whether a studio takes an inquiry that names no artist (TAT-51): yes when
 * it has no visible artist (general inquiries) or while at least one
 * visible artist accepts; no when every visible artist is closed. Intake's
 * `studio_not_accepting` and the public Studio's `acceptingInquiries`
 * (TAT-44) both come from here, so the studio page never offers a form the
 * API refuses. Pass the studio's visible artists (ArtistService.listVisible).
 */
export function studioTakesInquiries(
	visible: readonly Pick<Artist, "acceptingInquiries">[],
): boolean {
	return (
		visible.length === 0 || visible.some((artist) => artist.acceptingInquiries)
	);
}
