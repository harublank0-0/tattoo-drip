import { Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { copyText } from "../browser.ts";
import { copy } from "../copy.ts";

/** How long "Copied" shows. */
export const COPIED_MS = 2_000;

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
	const [result, setResult] = useState<"copied" | "failed" | null>(null);

	useEffect(() => {
		if (result !== "copied") return;
		const timer = window.setTimeout(() => setResult(null), COPIED_MS);
		return () => window.clearTimeout(timer);
	}, [result]);

	return (
		<>
			<button
				type="button"
				className="deposit-copy"
				aria-label={label}
				onClick={() => {
					void copyText(text).then((ok) => setResult(ok ? "copied" : "failed"));
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
