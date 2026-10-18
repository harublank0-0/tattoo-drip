export const SESSION_RULE_REASONS = [
	"project_closed",
	"not_scheduled",
	"invalid_range",
	"not_started",
	"not_booked",
] as const;
export type SessionRuleReason = (typeof SESSION_RULE_REASONS)[number];

const MESSAGES: Record<SessionRuleReason, string> = {
	project_closed: "A declined or cancelled project takes no new sessions",
	not_scheduled: "Only a scheduled session can be changed",
	invalid_range: "A session must end after it starts",
	not_started:
		"Only a session that has started can be marked completed or no-show",
	not_booked:
		"A tattoo session can be marked completed only once its project is booked",
};

/**
 * A scheduling rule was broken; `reason` says which. The message is for
 * developers; show your own to the user.
 */
export class SessionRuleError extends Error {
	constructor(readonly reason: SessionRuleReason) {
		super(MESSAGES[reason]);
		this.name = "SessionRuleError";
	}
}

/**
 * The artist already has a scheduled or completed session that overlaps this
 * time. The message is for developers; show your own to the user.
 */
export class SessionOverlapError extends Error {
	constructor() {
		super("The artist already has a session at that time");
		this.name = "SessionOverlapError";
	}
}
