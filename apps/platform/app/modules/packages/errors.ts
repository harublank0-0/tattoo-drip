export type PackageRule =
	| "artist_limit"
	| "paused"
	| "paused_new_work"
	| "paused_design_lab";

/** What each refusal says to the owner (studio packages, phase 2). */
export const PACKAGE_RULE_MESSAGES: Record<PackageRule, string> = {
	artist_limit:
		"Solo includes one active artist. Archive an artist, or upgrade to Studio.",
	paused: "Pay for a package to add an active artist.",
	paused_new_work:
		"Starting new client work is paused until your package is paid. Your existing projects, bookings, payments and page keep working.",
	paused_design_lab:
		"Design Lab is paused until your package is paid. Your saved concepts stay available.",
};

/**
 * A package rule refused an action (enforce mode only; observe mode logs
 * instead). The message is for the owner.
 */
export class PackageRuleError extends Error {
	constructor(readonly code: PackageRule) {
		super(PACKAGE_RULE_MESSAGES[code]);
		this.name = "PackageRuleError";
	}
}
