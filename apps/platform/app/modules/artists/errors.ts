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

/**
 * The artist already shows the most work photos there are room for (TAT-116).
 * The message is for developers; the dashboard words its own.
 */
export class WorkPhotoLimitError extends Error {
	constructor() {
		super("The artist already has the most work photos allowed");
		this.name = "WorkPhotoLimitError";
	}
}

/**
 * A tattoo already has the most photos it can show: its lead and seven
 * angles (MAX_TATTOO_PHOTOS). The message is for developers; the dashboard
 * words its own.
 */
export class TattooPhotoLimitError extends Error {
	constructor() {
		super("The tattoo already has the most photos allowed");
		this.name = "TattooPhotoLimitError";
	}
}

/**
 * Why several photos cannot be grouped as one tattoo: too few or too many
 * (`count`), of more than one artist (`artists`), one is already another
 * tattoo's angle (`angle`), or one already leads a tattoo of its own
 * (`has_angles`: nothing is merged silently), or published and unpublished
 * photos together (`mixed`: grouping never publishes or hides a photo). The
 * dashboard words each.
 */
export class TattooGroupError extends Error {
	constructor(
		readonly reason: "count" | "artists" | "angle" | "has_angles" | "mixed",
	) {
		super(`These photos can't be grouped as one tattoo (${reason})`);
		this.name = "TattooGroupError";
	}
}

/**
 * The tattoo is not what the request thought it was: the order sent names
 * other photos than the tattoo has now, or the photo is no longer a lead
 * (another change landed first). The page reloads and the member tries again.
 */
export class TattooChangedError extends Error {
	constructor() {
		super("The tattoo changed meanwhile");
		this.name = "TattooChangedError";
	}
}

/**
 * Video angles: a video is never a tattoo's main photo, so it cannot be put
 * first in a tattoo's order nor taken out of its tattoo (it would lead one of
 * its own). The database refuses it too (`artist_work_photos_video_is_angle`
 * and the guard trigger); this is the friendly refusal.
 */
export class VideoLeadError extends Error {
	constructor() {
		super("A video can't lead a tattoo");
		this.name = "VideoLeadError";
	}
}

/**
 * Video angles: the upload a "finish" names can't be used: its token is not
 * this tattoo's, has expired or was used already, or the staged file is
 * missing or not the length that was signed. The message is for the studio.
 */
export class VideoUploadError extends Error {
	constructor(message = "This upload can't be used. Choose the video again.") {
		super(message);
		this.name = "VideoUploadError";
	}
}
