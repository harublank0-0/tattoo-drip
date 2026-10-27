import { ArtistWorkPhotoSchema } from "#database/schema";

/**
 * One public photo of an artist's work (TAT-116). Not soft-deleted: removing
 * a photo deletes the row and its files. Read and change them through
 * WorkPhotoService, not from other modules directly.
 */
export default class ArtistWorkPhoto extends ArtistWorkPhotoSchema {}
