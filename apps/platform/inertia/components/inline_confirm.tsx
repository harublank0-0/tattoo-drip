import { type RefObject, useEffect, useRef, useState } from "react";
import {
	CONFIRM_CLOSED,
	type ConfirmEvent,
	type ConfirmState,
	confirmStep,
	focusBack,
} from "~/components/confirm";
import { Button } from "~/components/ui/button";

/**
 * Asks before a one-tap action, in the page and not in a dialog (TAT-108; it replaces
 * `window.confirm`): the trigger opens a panel with the question, the confirm button and the safe
 * button, and focus starts on the safe one so Enter right away changes nothing. Escape or the safe
 * button closes it and returns focus to the trigger. `onConfirm` starts the request and calls
 * `finished` when it answers (`onFinish`): the panel closes, whatever the answer, and focus goes
 * back to the trigger, or to `fallback` (the page's heading) when the answer removed it. Every
 * step is `confirmStep` (components/confirm.ts, unit-tested). Never inside a sheet: Escape would
 * close the sheet.
 */
export default function InlineConfirm({
	label,
	variant = "outline",
	question,
	confirmLabel,
	keepLabel,
	onConfirm,
	fallback,
}: {
	label: string;
	variant?: "default" | "outline" | "secondary";
	question: string;
	confirmLabel: string;
	keepLabel: string;
	onConfirm: (finished: () => void) => void;
	fallback: RefObject<HTMLElement | null>;
}) {
	const [state, setState] = useState<ConfirmState>(CONFIRM_CLOSED);
	const trigger = useRef<HTMLButtonElement>(null);
	const keep = useRef<HTMLButtonElement>(null);
	// Opening puts focus on the safe button, once it is on the page.
	useEffect(() => {
		if (state.open && !state.saving) keep.current?.focus();
	}, [state.open, state.saving]);

	const send = (event: ConfirmEvent) => {
		const next = confirmStep(state, event);
		setState({ open: next.open, saving: next.saving });
		// After the answer React has committed the new page: the button that had
		// focus may be gone, so focus waits one tick (as focusFirstInvalid does).
		if (next.focus === "trigger") {
			setTimeout(
				() => focusBack(trigger.current, fallback.current)?.focus(),
				0,
			);
		}
		return next;
	};
	const ask = () => send("ask");
	const keepIt = () => send("keep");
	const confirm = () => {
		if (send("confirm").saving) onConfirm(() => send("finished"));
	};

	return (
		<div className="flex min-w-0 flex-col gap-3">
			<div>
				<Button
					ref={trigger}
					type="button"
					variant={variant}
					aria-expanded={state.open}
					onClick={ask}
				>
					{label}
				</Button>
			</div>
			{state.open && (
				<fieldset
					className="min-w-0 rounded-md bg-muted/50 p-3"
					onKeyDown={(event) => {
						if (event.key === "Escape") keepIt();
					}}
				>
					<legend className="float-left mb-3 w-full text-sm">{question}</legend>
					<div className="clear-left flex flex-wrap gap-2">
						<Button
							type="button"
							className="h-11"
							disabled={state.saving}
							onClick={confirm}
						>
							{state.saving ? "Saving…" : confirmLabel}
						</Button>
						<Button
							ref={keep}
							type="button"
							variant="ghost"
							className="h-11"
							disabled={state.saving}
							onClick={keepIt}
						>
							{keepLabel}
						</Button>
					</div>
				</fieldset>
			)}
		</div>
	);
}
