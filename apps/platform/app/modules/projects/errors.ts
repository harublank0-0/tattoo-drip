export const QUOTE_RULE_REASONS = [
	"project_closed",
	"not_quoted",
	"quote_changed",
	"expired",
] as const;
export type QuoteRuleReason = (typeof QUOTE_RULE_REASONS)[number];

const MESSAGES: Record<QuoteRuleReason, string> = {
	project_closed:
		"Only a reviewing, quoted, on-hold or deposit-pending project can be quoted",
	not_quoted: "Only a quoted project can accept its quote",
	quote_changed: "The quote is no longer the project's current quote",
	expired: "The quote has expired",
};

/**
 * A quote rule was broken; `reason` says which. Thrown after the failed
 * savepoint has rolled back, so the request stays usable. The message is for
 * developers; show your own to the user.
 */
export class QuoteRuleError extends Error {
	constructor(readonly reason: QuoteRuleReason) {
		super(MESSAGES[reason]);
		this.name = "QuoteRuleError";
	}
}

export const PROJECT_RULE_REASONS = ["move_not_allowed"] as const;
export type ProjectRuleReason = (typeof PROJECT_RULE_REASONS)[number];

const PROJECT_MESSAGES: Record<ProjectRuleReason, string> = {
	move_not_allowed: "The project's status does not allow that move",
};

/**
 * A project lifecycle rule was broken; `reason` says which. Thrown after the
 * failed savepoint has rolled back. The message is for developers; show
 * your own to the user.
 */
export class ProjectRuleError extends Error {
	constructor(readonly reason: ProjectRuleReason) {
		super(PROJECT_MESSAGES[reason]);
		this.name = "ProjectRuleError";
	}
}

export const BOOKING_RULE_REASONS = [
	"artist_unavailable",
	"client_unavailable",
] as const;
export type BookingRuleReason = (typeof BOOKING_RULE_REASONS)[number];

const BOOKING_MESSAGES: Record<BookingRuleReason, string> = {
	artist_unavailable:
		"The member may not book this artist: owners book the tenant's live artists, an artist only their own live profile",
	client_unavailable: "The client's details were deleted; they can't be booked",
};

/**
 * A direct booking (TAT-43) was refused; `reason` says which rule. Nothing
 * was saved. The message is for developers; show your own to the user.
 */
export class BookingRuleError extends Error {
	constructor(readonly reason: BookingRuleReason) {
		super(BOOKING_MESSAGES[reason]);
		this.name = "BookingRuleError";
	}
}
