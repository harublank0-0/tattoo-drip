/**
 * The dashboard's visit rules (TAT-84), installed once by `app.tsx` for every layout. A visit the
 * network cut off (no answer at all) gets a toast saying so, instead of the button quietly going
 * back to normal. A form whose answer has field errors gets focus on its first invalid field,
 * scrolled to the middle of the screen. It imports nothing, so the unit tests load it with a
 * jsdom document passed in (`visits.spec.ts`).
 */

export const PAGE_LOST =
	"Couldn't load the page. Check your connection and try again.";
export const SAVE_LOST =
	"The connection dropped before this was confirmed. Open the page again to see whether it saved, then try again if it didn't.";

/** The toast for a visit the network cut off: a page load (GET) or a save (anything else). */
export function connectionLostText(method: string): string {
	return method.toLowerCase() === "get" ? PAGE_LOST : SAVE_LOST;
}

const FOCUSABLE =
	'input:not([type="hidden"]), select, textarea, button, [tabindex]:not([tabindex="-1"])';

/**
 * The control to fix first in `scope`: the first element marked `aria-invalid="true"`, or,
 * when that is a group (a radio group marks its root), its checked choice, else its first.
 */
export function firstInvalidField(
	scope: ParentNode | null,
): HTMLElement | null {
	const invalid = scope?.querySelector<HTMLElement>('[aria-invalid="true"]');
	if (!invalid) return null;
	if (invalid.matches(FOCUSABLE)) return invalid;
	return (
		invalid.querySelector<HTMLElement>('[aria-checked="true"]') ??
		invalid.querySelector<HTMLElement>(FOCUSABLE)
	);
}

/** Focuses `field` in the middle of the screen, clear of the top bar and the tab bar. */
export function focusField(field: HTMLElement | null): void {
	if (!field) return;
	field.focus({ preventScroll: true });
	field.scrollIntoView?.({ block: "center" });
}

type VisitEvent = { detail: { visit?: { method: string } } };
/** Inertia's `router.on`, narrowed to the events used here. */
export type OnVisit = (
	type: "error" | "networkError" | "finish",
	callback: (event: VisitEvent) => boolean | undefined,
) => () => void;

/**
 * Installs the dashboard's visit rules and returns what removes them.
 *
 * A visit the network cut off (no answer at all) gets a toast at its `finish`, which carries
 * the method; the `networkError` handler returns false, so Inertia does not reject the visit's
 * promise. It never retries: a save may have reached the server before the answer was lost.
 *
 * A capture-phase `submit` listener remembers the form that was sent (only the element, dropped
 * at the next `finish`). When that visit's answer has field errors (`error`), its first invalid
 * field gets focus at `finish`, after a tick: the `<Form>` sets its errors in its own `onError`,
 * which Inertia calls after the global `error` event, and `finish` comes after that, so the tick
 * runs after that state update. A refusal without field errors (a flash) moves nothing.
 */
export function watchVisits(
	on: OnVisit,
	doc: Document,
	notify: (text: string) => void,
): () => void {
	let lost = false;
	let refused = false;
	let sent: HTMLFormElement | null = null;
	const remember = (event: Event) => {
		const target = event.target as Element | null;
		if (target?.tagName === "FORM") sent = target as HTMLFormElement;
	};
	doc.addEventListener("submit", remember, true);
	const stops = [
		on("networkError", () => {
			lost = true;
			return false;
		}),
		on("error", () => {
			refused = true;
			return undefined;
		}),
		on("finish", (event) => {
			if (lost) notify(connectionLostText(event.detail.visit?.method ?? "get"));
			const form = refused && sent?.isConnected ? sent : null;
			if (form) setTimeout(() => focusField(firstInvalidField(form)), 0);
			sent = null;
			refused = false;
			lost = false;
			return undefined;
		}),
	];
	return () => {
		for (const stop of stops) stop();
		doc.removeEventListener("submit", remember, true);
	};
}
