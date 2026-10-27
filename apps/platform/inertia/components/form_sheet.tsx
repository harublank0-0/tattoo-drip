import {
	type FormEvent,
	type ReactNode,
	type RefObject,
	useEffect,
	useReducer,
	useRef,
} from "react";
import { toast } from "sonner";
import { focusBack } from "~/components/confirm";
import {
	maySubmit,
	SHEET_CLOSED,
	type SheetEvent,
	type SheetFlash,
	sheetStep,
} from "~/components/sheets";
import { Button } from "~/components/ui/button";
import {
	Sheet,
	SheetClose,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
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
	// The same steps, applied at once: a held key can send a second submit before React renders.
	const latest = useRef(state);
	const send = (event: SheetEvent) => {
		latest.current = sheetStep(latest.current, event);
		dispatch(event);
	};
	// The sheet's body, where focus goes to the first field that needs fixing.
	const body = useRef<HTMLDivElement>(null);
	// Whichever trigger draws it right now (the Next step card or the card that owns the control).
	const trigger = useRef<HTMLButtonElement>(null);
	// A refusal is shown inside the sheet that is open: the page's toast would only cover its title.
	useEffect(() => {
		if (!state.message) return;
		const later = setTimeout(() => toast.dismiss("flash"), 0);
		return () => clearTimeout(later);
	}, [state.message]);
	return {
		state,
		body,
		trigger,
		onError: () => focusFirstInvalid(body.current),
		onOpenChange: (open: boolean) => send({ type: open ? "open" : "dismiss" }),
		onStart: () => send({ type: "start" }),
		onSuccess: (page: { flash?: SheetFlash }) =>
			send({ type: "saved", flash: page.flash }),
		/** What the sheet edits is no longer on the page: it closes. */
		onUnavailable: () => send({ type: "unavailable" }),
		onFinish: () => send({ type: "finished" }),
		/**
		 * Capture-phase guard for the form's `submit` (`maySubmit`): nothing is sent from a sheet
		 * that is closed or closing, or while its request is out.
		 */
		guard: (event: FormEvent) => {
			if (maySubmit(latest.current)) return;
			event.preventDefault();
			event.stopPropagation();
		},
	};
}
export type FormSheetState = ReturnType<typeof useFormSheet>;

/**
 * The five sheets of the project page, one instance each, held by the page (TAT-108 fix round):
 * the state of a sheet must not live in the card that draws its trigger, because the Next step can
 * move a trigger to another card while the sheet is open (a stale Revise whose refusal returns the
 * project in another status), and an unmounted sheet would take the refusal with it.
 */
export function usePageSheets() {
	return {
		revise: useFormSheet(),
		record: useFormSheet(),
		refund: useFormSheet(),
		price: useFormSheet(),
		schedule: useFormSheet(),
	};
}
export type PageSheets = ReturnType<typeof usePageSheets>;

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
 * The button that opens a sheet (TAT-108). Any card may draw it; the sheet itself is the page's
 * (`FormSheetPanel`). Only one trigger of a sheet is on the page at a time, and it is where focus
 * goes back to when the sheet closes.
 */
export function FormSheetTrigger({
	sheet,
	label,
	variant = "outline",
}: {
	sheet: FormSheetState;
	label: string;
	variant?: "default" | "outline";
}) {
	return (
		<Button
			ref={sheet.trigger}
			type="button"
			variant={variant}
			aria-haspopup="dialog"
			aria-expanded={sheet.state.open}
			onClick={() => sheet.onOpenChange(true)}
		>
			{label}
		</Button>
	);
}

/**
 * A bottom sheet holding one form (TAT-108): the title and description, the refusal's message (a
 * `role="alert"` paragraph, because the toast's live region is hidden from screen readers while a
 * modal is open), then the `Form`. Radix moves focus into the sheet, traps it, closes on Escape, the
 * close button and the overlay, and focus goes back to the trigger, or to `fallback` (the page's
 * heading) when a save removed the trigger. `available` is false when what the sheet edits is no
 * longer on the page: it closes then and can't open by itself later.
 */
export function FormSheetPanel({
	sheet,
	title,
	description,
	fallback,
	available,
	children,
}: {
	sheet: FormSheetState;
	title: string;
	description: string;
	fallback: RefObject<HTMLElement | null>;
	available: boolean;
	children: ReactNode;
}) {
	const { onUnavailable } = sheet;
	useEffect(() => {
		if (!available) onUnavailable();
	}, [available, onUnavailable]);
	if (!available) return null;

	return (
		<Sheet open={sheet.state.open} onOpenChange={sheet.onOpenChange}>
			<SheetContent
				side="bottom"
				// A closing sheet stays on the page for its exit animation: nothing in it can be used.
				inert={!sheet.state.open}
				onSubmitCapture={sheet.guard}
				onCloseAutoFocus={(event) => {
					event.preventDefault();
					focusBack(sheet.trigger.current, fallback.current)?.focus();
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
