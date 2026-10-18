import { Copy } from "lucide-react";
import { useEffect, useReducer } from "react";
import { copyText } from "../browser.ts";
import { copy } from "../copy.ts";

/** How long "Copied" shows. */
export const COPIED_MS = 2_000;
/** How long "Couldn't copy" shows: longer, it says what to do instead. */
export const FAILED_MS = 6_000;

export type CopyResult = "copied" | "failed" | null;
type CopyAction =
	| { type: "tap" }
	| { type: "done"; ok: boolean }
	| { type: "expire" };

/**
 * A tap clears the last result first: a second failure then is a change in
 * the live region (text back after none), which a screen reader announces.
 */
export function copyReducer(_: CopyResult, action: CopyAction): CopyResult {
	if (action.type === "done") return action.ok ? "copied" : "failed";
	return null;
}

/** How long a result stays, or null when there is none to remove. */
export function resultMs(result: CopyResult): number | null {
	if (result === "copied") return COPIED_MS;
	return result === "failed" ? FAILED_MS : null;
}

/**
 * A Copy button and its polite live region (spec ruling 13). `label` is the
 * accessible name and starts with the visible words (WCAG 2.5.3).
 */
export function CopyButton({
	text,
	label,
	visible,
}: {
	text: string;
	label: string;
	visible: string;
}) {
	const [result, dispatch] = useReducer(copyReducer, null);

	useEffect(() => {
		const wait = resultMs(result);
		if (wait === null) return;
		const timer = window.setTimeout(() => dispatch({ type: "expire" }), wait);
		return () => window.clearTimeout(timer);
	}, [result]);

	return (
		<>
			<button
				type="button"
				className="deposit-copy"
				aria-label={label}
				onClick={() => {
					dispatch({ type: "tap" });
					void copyText(text).then((ok) => dispatch({ type: "done", ok }));
				}}
			>
				<Copy aria-hidden="true" className="size-4" />
				{visible}
			</button>
			<span className="deposit-copied" aria-live="polite">
				{result === "copied"
					? copy.copied
					: result === "failed"
						? copy.copyFailed
						: ""}
			</span>
		</>
	);
}
