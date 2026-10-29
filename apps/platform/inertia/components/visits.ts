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

/** What Inertia 3.8 puts in the events: `start` and `finish` carry the visit itself. */
type VisitInfo = { id?: string; method?: string; url?: unknown };
type VisitEvent = {
	detail: { visit?: VisitInfo; visitId?: string; error?: unknown };
};
/** Inertia's `router.on`, narrowed to the events used here. */
export type OnVisit = (
	type: "start" | "error" | "networkError" | "finish",
	callback: (event: VisitEvent) => boolean | undefined,
) => () => void;

/** An address without its fragment: how a visit's `url` and a network error's `url` compare. */
const addressOf = (url: unknown): string =>
	url == null ? "" : String(url).split("#")[0];

/**
 * Installs the dashboard's visit rules and returns what removes them. Visits overlap (a sync
 * visit interrupts the one in flight, async ones such as the notes save run alongside), so
 * everything is kept per visit and each `finish` uses only its own visit's entries.
 *
 * A visit the network cut off (no answer at all) gets a toast at its `finish`, which carries
 * the method; the `networkError` handler returns false, so Inertia does not reject the visit's
 * promise. It never retries: a save may have reached the server before the answer was lost.
 * Only a lost connection counts (`isNetworkError`, Inertia's `HttpNetworkError`, passed in by
 * `app.tsx` so this module imports nothing): Inertia 3.8 also hands `networkError` any exception
 * thrown while it handles an answer (resolving a component, an `onSuccess` callback), and that
 * one gets no toast and is not cancelled, so the visit rejects as before. `networkError` names
 * the failed address, not the visit, so the entry is matched to the `finish` that follows it by
 * address; it can only wait for the microtasks between the two, so it expires with the task.
 *
 * A capture-phase `submit` listener notes the form that was sent. Inertia then fires `before`,
 * interrupts the visit in flight (its `finish` comes at once) and fires `start` for the new one,
 * all in the same task, so the form is bound to the visit id at that `start`; a submit that
 * starts no visit is forgotten at the end of its task and cannot bind to a later, unrelated
 * visit. When that visit's answer has field errors (`error`, which names its visit), its first
 * invalid field gets focus at its own `finish`, after a tick: the `<Form>` sets its errors in its
 * own `onError`, which Inertia calls after the global `error` event, and `finish` comes after
 * that, so the tick runs after that state update. A refusal without field errors (a flash)
 * moves nothing.
 */
export function watchVisits(
	on: OnVisit,
	doc: Document,
	notify: (text: string) => void,
	isNetworkError: (error: unknown) => boolean,
): () => void {
	/** The form just submitted, until a visit starts or the task ends. */
	let pending: HTMLFormElement | null = null;
	let forgetPending: ReturnType<typeof setTimeout> | undefined;
	const forms = new Map<string, HTMLFormElement>();
	const refused = new Set<string>();
	/** One entry per visit cut off by the network, until its `finish`: the address ("" if unknown). */
	const lost: { address: string }[] = [];

	const remember = (event: Event) => {
		const target = event.target as Element | null;
		if (target?.tagName !== "FORM") return;
		const form = target as HTMLFormElement;
		pending = form;
		clearTimeout(forgetPending);
		forgetPending = setTimeout(() => {
			if (pending === form) pending = null;
		}, 0);
	};
	doc.addEventListener("submit", remember, true);

	const stops = [
		on("start", (event) => {
			const id = event.detail.visit?.id;
			if (id && pending) {
				forms.set(id, pending);
				pending = null;
			}
			return undefined;
		}),
		on("networkError", (event) => {
			const error = event.detail.error;
			if (!isNetworkError(error)) return undefined;
			const entry = { address: addressOf((error as { url?: unknown }).url) };
			lost.push(entry);
			setTimeout(() => {
				const at = lost.indexOf(entry);
				if (at >= 0) lost.splice(at, 1);
			}, 0);
			return false;
		}),
		on("error", (event) => {
			const id = event.detail.visitId;
			if (id) refused.add(id);
			return undefined;
		}),
		on("finish", (event) => {
			const visit = event.detail.visit;
			const address = addressOf(visit?.url);
			const at = lost.findIndex((entry) => entry.address === address);
			const unnamed =
				at >= 0 ? at : lost.findIndex((entry) => entry.address === "");
			if (unnamed >= 0) {
				lost.splice(unnamed, 1);
				notify(connectionLostText(visit?.method ?? "get"));
			}
			const id = visit?.id;
			if (id) {
				const form = forms.get(id);
				forms.delete(id);
				if (refused.delete(id) && form?.isConnected) {
					setTimeout(() => focusField(firstInvalidField(form)), 0);
				}
			}
			return undefined;
		}),
	];
	return () => {
		for (const stop of stops) stop();
		doc.removeEventListener("submit", remember, true);
		clearTimeout(forgetPending);
	};
}
