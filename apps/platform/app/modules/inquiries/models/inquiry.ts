import { compose } from "@adonisjs/core/helpers";
import { InquirySchema } from "#database/schema";
import { withSoftDeletes } from "#models/mixins/soft_deletes";

export const INQUIRY_STATUSES = ["new", "accepted", "declined"] as const;
export type InquiryStatus = (typeof INQUIRY_STATUSES)[number];

export const SOURCE_CHANNELS = [
	"instagram",
	"facebook",
	"tiktok",
	"google",
	"friend",
	"other",
] as const;
export type SourceChannel = (typeof SOURCE_CHANNELS)[number];

/**
 * What a person asked a studio for, exactly as submitted. A database
 * trigger freezes everything except the decision (and the privacy scrub
 * when `anonymizedAt` is set), so do not try to edit the submitted fields.
 * Services arrive with TAT-51 (intake) and TAT-46 (inbox).
 */
export default class Inquiry extends compose(InquirySchema, withSoftDeletes) {
	declare status: InquiryStatus;
	declare sourceChannel: SourceChannel;
}
