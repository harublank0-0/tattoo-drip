export const INQUIRY_RULE_REASONS = [
	"already_decided",
	"artist_unavailable",
	"artist_not_accepting",
	"studio_not_accepting",
	"too_many_open_inquiries",
] as const;
export type InquiryRuleReason = (typeof INQUIRY_RULE_REASONS)[number];

const MESSAGES: Record<InquiryRuleReason, string> = {
	already_decided: "The inquiry was already accepted or declined",
	artist_unavailable:
		"The artist is not one of the tenant's live artists (for intake: live and visible)",
	artist_not_accepting: "The chosen artist is not accepting inquiries",
	studio_not_accepting:
		"No artist was chosen and none of the tenant's visible artists accepts inquiries",
	too_many_open_inquiries:
		"The phone already has as many open inquiries as the tenant takes",
};

/**
 * An inbox or intake rule was broken; `reason` says which. Thrown after the
 * failed savepoint has rolled back. The message is for developers; show your
 * own to the user.
 */
export class InquiryRuleError extends Error {
	constructor(readonly reason: InquiryRuleReason) {
		super(MESSAGES[reason]);
		this.name = "InquiryRuleError";
	}
}

/**
 * An upload in an inquiry that isn't an image we accept (TAT-51). `index` is
 * its place among the reference images; the message is the user's, like
 * InvalidImageError's.
 */
export class InvalidReferenceImageError extends Error {
	constructor(
		readonly index: number,
		message: string,
		options?: ErrorOptions,
	) {
		super(message, options);
		this.name = "InvalidReferenceImageError";
	}
}
