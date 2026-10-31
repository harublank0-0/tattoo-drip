import { FlashDesignSchema } from "#database/schema";

/**
 * One flash design of an artist (TAT-129): a picture, a name, a size and an
 * optional price in paisa. Not soft-deleted: removing a design deletes the
 * row and its files, unless a request or a project names it (then the studio
 * hides it). Read and change them through FlashService, not from other
 * modules directly.
 */
export default class FlashDesign extends FlashDesignSchema {}
