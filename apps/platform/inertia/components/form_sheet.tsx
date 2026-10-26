import { type ReactNode, type RefObject, useReducer, useRef } from "react";
import { focusBack } from "~/components/confirm";
import { SHEET_CLOSED, type SheetFlash, sheetStep } from "~/components/sheets";
import { Button } from "~/components/ui/button";
import {
	Sheet,
	SheetClose,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "~/components/ui/sheet";

/**
 * The state of one form sheet (TAT-108): `sheetStep` (components/sheets.ts, unit-tested) decides
 * every change. Hand `onStart`, `onSuccess` and `onFinish` to the sheet's `Form`: a save the rules
 * refuse (an error flash comes back as a successful visit) keeps the sheet open with the message,
 * and a field error (`onError`) leaves it open with the typed values, because the page stays
 * mounted. `onError` puts focus on the first field that needs fixing.
 */
export function useFormSheet() {
	const [state, dispatch] = useReducer(sheetStep, SHEET_CLOSED);
	// The sheet's body, where focus goes to the first field that needs fixing.
	const body = useRef<HTMLDivElement>(null);
	return {
		state,
		body,
		onError: () => focusFirstInvalid(body.current),
		onOpenChange: (open: boolean) =>
			dispatch({ type: open ? "open" : "dismiss" }),
		onStart: () => dispatch({ type: "start" }),
		onSuccess: (page: { flash?: SheetFlash }) =>
			dispatch({ type: "saved", flash: page.flash }),
		onFinish: () => dispatch({ type: "finished" }),
	};
}
export type FormSheetState = ReturnType<typeof useFormSheet>;

/**
 * After a refused save the submit button was disabled while saving, which drops keyboard focus
 * to the page (and Escape stops working), so focus goes to the first field that needs fixing.
 */
export function focusFirstInvalid(container: HTMLElement | null) {
	setTimeout(() => {
		container?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
	}, 0);
}

/**
 * A button that opens a bottom sheet holding one form (TAT-108): the title and description, the
 * refusal's message (a `role="alert"` paragraph, because the toast's live region is hidden from
 * screen readers while a modal is open), then the `Form`. Radix moves focus into the sheet,
 * traps it, closes on Escape, the close button and the overlay, and focus goes back to the
 * trigger, or to `fallback` (the page's heading) when a save removed the trigger.
 */
export default function FormSheet({
	label,
	variant = "outline",
	title,
	description,
	sheet,
	fallback,
	children,
}: {
	label: string;
	variant?: "default" | "outline";
	title: string;
	description: string;
	sheet: FormSheetState;
	fallback: RefObject<HTMLElement | null>;
	children: ReactNode;
}) {
	const trigger = useRef<HTMLButtonElement>(null);

	return (
		<Sheet open={sheet.state.open} onOpenChange={sheet.onOpenChange}>
			<SheetTrigger asChild>
				<Button ref={trigger} type="button" variant={variant}>
					{label}
				</Button>
			</SheetTrigger>
			<SheetContent
				side="bottom"
				onCloseAutoFocus={(event) => {
					event.preventDefault();
					focusBack(trigger.current, fallback.current)?.focus();
				}}
			>
				<SheetHeader className="pr-14">
					<SheetTitle>{title}</SheetTitle>
					<SheetDescription>{description}</SheetDescription>
				</SheetHeader>
				<div ref={sheet.body} className="flex flex-col gap-4 px-4 pb-4">
					{sheet.state.message && (
						<p
							role="alert"
							className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm"
						>
							{sheet.state.message}
						</p>
					)}
					{children}
				</div>
			</SheetContent>
		</Sheet>
	);
}

/**
 * The sheet's buttons, inside its `Form`: the submit (it says "Saving…" while the request is out;
 * a refund and a price name the amount) and Cancel, which closes the sheet.
 */
export function FormSheetActions({
	submit,
	processing,
}: {
	submit: string;
	processing: boolean;
}) {
	return (
		<div className="flex flex-wrap gap-2">
			<Button type="submit" className="h-11" disabled={processing}>
				{processing ? "Saving…" : submit}
			</Button>
			<SheetClose asChild>
				<Button
					type="button"
					variant="ghost"
					className="h-11"
					disabled={processing}
				>
					Cancel
				</Button>
			</SheetClose>
		</div>
	);
}
