export const CLIENT_RULE_REASONS = ["phone_taken", "anonymized"] as const;
export type ClientRuleReason = (typeof CLIENT_RULE_REASONS)[number];

const MESSAGES: Record<ClientRuleReason, string> = {
	phone_taken: "Another live client of the tenant has this phone",
	anonymized: "The client's details were deleted; it can't be edited",
};

/**
 * A client rule was broken; `reason` says which. Thrown after the failed
 * savepoint has rolled back. The message is for developers; show your own
 * to the user.
 */
export class ClientRuleError extends Error {
	constructor(readonly reason: ClientRuleReason) {
		super(MESSAGES[reason]);
		this.name = "ClientRuleError";
	}
}
