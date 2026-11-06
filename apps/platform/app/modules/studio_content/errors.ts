/** A list longer than its limit (MAX_FAQ_ENTRIES, MAX_POLICY_SECTIONS); nothing was written. */
export class ContentLimitError extends Error {
	constructor(readonly list: "faq" | "policies") {
		super(`Too many ${list === "faq" ? "FAQ entries" : "policy sections"}`);
		this.name = "ContentLimitError";
	}
}
