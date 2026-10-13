import { QuoteSchema } from "#database/schema";

export const QUOTE_KINDS = ["fixed", "hourly"] as const;
export type QuoteKind = (typeof QUOTE_KINDS)[number];

/**
 * A price for a project. A revision is a new row with the next `version`;
 * the current quote is the project's highest version. Not soft-deletable:
 * quotes are history. Money is integer paisa; time is whole minutes.
 */
export default class Quote extends QuoteSchema {
	declare kind: QuoteKind;
}
