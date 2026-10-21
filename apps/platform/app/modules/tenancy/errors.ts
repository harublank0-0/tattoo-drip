/**
 * Another tenant got this slug first, usually by racing past validation.
 * Show it as a field error on `slug`.
 */
export class SlugTakenError extends Error {
	constructor(readonly slug: string) {
		super(`The slug "${slug}" is already taken`);
		this.name = "SlugTakenError";
	}
}

/**
 * Removing or demoting this membership would leave the tenant without an
 * owner. Every tenant must keep at least one.
 */
export class LastOwnerError extends Error {
	constructor(readonly tenantId: string) {
		super("A tenant must keep at least one owner");
		this.name = "LastOwnerError";
	}
}

/**
 * The tenant already holds MAX_TENANT_SLUGS slugs and asked for a new one.
 * Switching back to one of its own old slugs is still allowed. Show it as
 * a field error on `slug`.
 */
export class SlugLimitError extends Error {
	constructor(readonly tenantId: string) {
		super(`Tenant ${tenantId} holds the most slugs allowed`);
		this.name = "SlugLimitError";
	}
}

/** Why an invitation can't be made or accepted (TAT-33). */
export const INVITATION_RULES = [
	/** No live invitation for this token and flow: used, cancelled, replaced or never made. */
	"invalid",
	"expired",
	/** The account's address isn't confirmed (TAT-18). */
	"unverified",
	/** The signed-in account's address isn't the invited one. */
	"wrong_account",
	"already_member",
	/** The profile offered is gone or linked to someone. */
	"profile_unavailable",
] as const;
export type InvitationRule = (typeof INVITATION_RULES)[number];

/** An invitation refused for `reason`. Controllers write their own messages. */
export class InvitationRuleError extends Error {
	constructor(readonly reason: InvitationRule) {
		super(`Invitation refused: ${reason}`);
		this.name = "InvitationRuleError";
	}
}

/**
 * An owner acting on their own membership (TAT-33): removing yourself or
 * changing your own role isn't done here.
 */
export class MemberRuleError extends Error {
	constructor(readonly reason: "self") {
		super(`Member change refused: ${reason}`);
		this.name = "MemberRuleError";
	}
}

/**
 * assertKeepsAnOwner was asked about a membership that isn't a live one of the
 * tenant: removed, or never there. A caller bug when the id came from
 * nowhere; MemberService turns it into a 404 for a member removed meanwhile.
 */
export class MembershipNotLiveError extends Error {
	constructor(
		readonly membershipId: string,
		readonly tenantId: string,
	) {
		super(
			`Membership ${membershipId} is not a live membership of tenant ${tenantId}`,
		);
		this.name = "MembershipNotLiveError";
	}
}
