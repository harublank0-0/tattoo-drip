import { useLayoutEffect, useRef, useState } from "react";

/**
 * The message preview's fold (TAT-104). Imports only React, so the unit tests
 * load it (with jsdom, see docs/testing.md).
 */

/** How many lines of a message the folded preview shows (the `line-clamp-2` class). */
export const FOLD_LINES = 2;

/**
 * The preview's fold: it is clamped to FOLD_LINES until opened, and the
 * toggle shows only when there is more to see (or to hide again).
 */
export function foldToggle(
	expanded: boolean,
	overflows: boolean,
): { clamp: boolean; showToggle: boolean; label: string } {
	return {
		clamp: !expanded,
		showToggle: expanded || overflows,
		label: expanded ? "Hide message" : "Show message",
	};
}

/** The state of one folded preview: put `textRef` on its text and `toggleRef` on its toggle. */
export function useFold(text: string) {
	const [expanded, setExpanded] = useState(false);
	const [overflows, setOverflows] = useState(false);
	const textRef = useRef<HTMLParagraphElement>(null);
	const toggleRef = useRef<HTMLButtonElement>(null);

	// Only the folded text can be measured: open, it shows everything. The
	// text is a dependency: a new message of the same kind (a preserved
	// Inertia update) can need a third line while the clamped box keeps its
	// size, and then no resize fires.
	// biome-ignore lint/correctness/useExhaustiveDependencies: `text` is not read, it only says when to measure again
	useLayoutEffect(() => {
		const element = textRef.current;
		if (!element || expanded) return;
		const measure = () => {
			const more = element.scrollHeight > element.clientHeight + 1;
			// The toggle goes with nothing left to fold: focus on it would
			// fall to <body>, so it moves to the text.
			if (!more && document.activeElement === toggleRef.current) {
				element.focus();
			}
			setOverflows(more);
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => observer.disconnect();
	}, [expanded, text]);

	return {
		...foldToggle(expanded, overflows),
		expanded,
		setExpanded,
		textRef,
		toggleRef,
	};
}
