import { StudioFaqEntrySchema } from "#database/schema";

/**
 * One question and answer the studio wrote for its FAQ, in place
 * `position` (0-based). Plain text. Read and replace through
 * StudioContentService, which writes the whole list at once.
 */
export default class StudioFaqEntry extends StudioFaqEntrySchema {}
