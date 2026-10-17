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
 * trigger freezes everything except the decision (and the privacy scrub, only
 * in the update that first sets `anonymizedAt`), so do not try to edit the
 * submitted fields. InquiryService (TAT-46) reads and decides them;
 * IntakeService (TAT-51) creates them. `softDelete()` does not cascade to the
 * inquiry's children yet (only `Tenant.softDelete` does); do not call it
 * elsewhere before TAT-42.
 */
export default class Inquiry extends compose(InquirySchema, withSoftDeletes) {
	declare status: InquiryStatus;
	declare sourceChannel: SourceChannel;
}
