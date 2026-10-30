/**
 * The artist already shows the most flash designs there are room for
 * (TAT-129). The message is for developers; the dashboard words its own.
 */
export class FlashLimitError extends Error {
	constructor() {
		super("The artist already has the most flash designs allowed");
		this.name = "FlashLimitError";
	}
}

/**
 * An inquiry or a project names this design, so it can't be deleted: the
 * studio hides it instead. The message is for developers; the dashboard
 * words its own.
 */
export class FlashInUseError extends Error {
	constructor() {
		super("A request or a project names this flash design");
		this.name = "FlashInUseError";
	}
}

export const FLASH_RULE_REASONS = ["repeatable"] as const;
export type FlashRuleReason = (typeof FLASH_RULE_REASONS)[number];

const MESSAGES: Record<FlashRuleReason, string> = {
	repeatable: "A design that can be tattooed again is never claimed",
};

/**
 * A flash rule was broken; `reason` says which. `repeatable`: a claim (or its
 * release by hand) on a design that is not one of a kind. The message is for
 * developers; the dashboard words its own.
 */
export class FlashRuleError extends Error {
	constructor(readonly reason: FlashRuleReason) {
		super(MESSAGES[reason]);
		this.name = "FlashRuleError";
	}
}
