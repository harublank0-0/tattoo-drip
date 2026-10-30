import { createContext, useContext } from "react";

/**
 * Whether the project on the page asks for a design somebody else has claimed
 * (TAT-129, part 4b): the page sets it once, and the quote form, the deposit
 * link and Verify, wherever the page draws them (their own cards, the Next
 * step card, the revise sheet), warn before they act. It is only a warning:
 * every action still goes through as before.
 */
const DesignTaken = createContext(false);

export const DesignTakenProvider = DesignTaken.Provider;

/** True while the project's design is claimed by anything but this project. */
export function useDesignTaken(): boolean {
	return useContext(DesignTaken);
}
