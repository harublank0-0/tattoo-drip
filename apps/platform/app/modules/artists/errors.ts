/**
 * Another live artist of the same tenant already uses this slug. The
 * message is for developers; show your own to the user.
 */
export class ArtistSlugTakenError extends Error {
	constructor(readonly slug: string) {
		super(`The artist slug "${slug}" is already in use`);
		this.name = "ArtistSlugTakenError";
	}
}

/**
 * The signed-in member already has a live profile in this tenant.
 */
export class ArtistProfileExistsError extends Error {
	constructor() {
		super("This member already has an artist profile in this tenant");
		this.name = "ArtistProfileExistsError";
	}
}
