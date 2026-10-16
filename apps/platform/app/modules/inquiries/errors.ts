export const INQUIRY_RULE_REASONS = [
	"already_decided",
	"artist_unavailable",
] as const;
export type InquiryRuleReason = (typeof INQUIRY_RULE_REASONS)[number];

const MESSAGES: Record<InquiryRuleReason, string> = {
	already_decided: "The inquiry was already accepted or declined",
	artist_unavailable: "The artist is not one of the tenant's live artists",
};

/**
 * An inbox rule was broken; `reason` says which. Thrown after the failed
 * savepoint has rolled back. The message is for developers; show your own
 * to the user.
 */
export class InquiryRuleError extends Error {
	constructor(readonly reason: InquiryRuleReason) {
		super(MESSAGES[reason]);
		this.name = "InquiryRuleError";
	}
}
