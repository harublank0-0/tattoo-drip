/**
 * Opens a work photo's viewer (TAT-116): the browser's own modal `<dialog>`,
 * which handles Escape, the first focus, the return of focus and the page
 * behind it. The one place the studio page touches the DOM, so only the
 * browser pass covers it (and test/studio/lightbox-guard.test.ts and
 * lightbox-history.test.ts, with the DOM stood in);
 * test/studio/lightbox.test.ts keeps it the only one. Before the page
 * hydrates, or without JavaScript, the photo buttons do nothing and the grid
 * is the content.
 *
 * Back closes it (TAT-123): an open photo has one history entry (addEntry), so
 * the phone's Back button, an iOS swipe or the browser's Back closes the
 * viewer instead of leaving the page.
 *
 * Where `<dialog>` is not supported (iOS before 15.4, Firefox before 98, old
 * WebViews) there is no viewer: the photo itself opens in its own page (the
 * large image's address was checked with the page's data), and the back
 * button returns to the studio page. The stylesheet hides the unopened dialogs
 * there, so the grid is all that shows. No entry is added there.
 */

/**
 * The history state key of an open photo's entry (TAT-123): its dialog id.
 * The rest of the entry's state is the router's own, copied.
 */
export const PHOTO_ENTRY = "tattooDripPhoto";

/**
 * While a closed photo's entry is being taken off (`history.back()`), until
 * the browser's popstate says it has moved. There is no timer: a slow back()
 * keeps the viewer shut, so a photo reopened and closed meanwhile cannot queue
 * a second traversal that leaves the studio page.
 */
let leaving = false;

export function showPhoto(id: string): void {
	const dialog = document.getElementById(id);
	if (!dialog) return;
	if (
		typeof HTMLDialogElement === "undefined" ||
		!(dialog instanceof HTMLDialogElement) ||
		typeof dialog.showModal !== "function"
	) {
		const large = dialog.querySelector("img");
		if (large?.src) window.location.assign(large.src);
		return;
	}
	if (dialog.open || leaving) return;
	dialog.showModal();
	addEntry(dialog, id);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A page loaded on an entry that still carries the viewer's marker (a reload
 * with a photo open, a duplicated tab) has no dialog open and, in a duplicated
 * tab, no earlier entry: a later Close would call back() with nowhere to go,
 * fire no popstate and keep the viewer shut. The marker is only ever set by
 * addEntry, after this module has loaded, so one found when it loads is a
 * leftover: take it off, keeping the router's state, through the browser's own
 * replaceState. The next photo then adds a new entry of its own, which has a
 * predecessor.
 */
export function forgetStaleEntry(): void {
	if (typeof window === "undefined") return;
	const history = window.history;
	const state: unknown = history.state;
	if (!isRecord(state) || !(PHOTO_ENTRY in state)) return;
	const { [PHOTO_ENTRY]: _marker, ...router } = state;
	History.prototype.replaceState.call(history, router, "");
}

forgetStaleEntry();

/** The browser has moved after a closed photo's back(): the viewer may open again. */
function arrived(): void {
	leaving = false;
}

/**
 * Back closes the photo (TAT-123): one entry while it is open, at the same
 * address (no URL is passed, so the address, its search and its hash never
 * change and a reload or a copied address is the page itself) with the
 * router's state copied, so the router sees the entry it is on. It goes
 * through the browser's own pushState (History.prototype): TanStack's history
 * wraps `window.history.pushState` and would run the page's loaders for it.
 * Back fires popstate: close. Escape, Close or Android's close request close
 * the dialog: take the entry off with one back(), if it is still current, and
 * wait for its popstate before another photo may open. An entry that is
 * marked when the photo opens (the browser's Forward returned to it) is
 * reused, not stacked.
 */
function addEntry(dialog: HTMLDialogElement, id: string): void {
	const history = window.history;
	const state: unknown = history.state;
	const own = isRecord(state) ? state : {};
	const entry = { ...own, [PHOTO_ENTRY]: id };
	if (PHOTO_ENTRY in own)
		History.prototype.replaceState.call(history, entry, "");
	else History.prototype.pushState.call(history, entry, "");

	const stop = () => {
		window.removeEventListener("popstate", onBack);
		dialog.removeEventListener("close", onClose);
	};
	function onBack() {
		stop();
		if (dialog.open) dialog.close();
	}
	function onClose() {
		stop();
		const current: unknown = window.history.state;
		if (!isRecord(current) || current[PHOTO_ENTRY] !== id) return;
		leaving = true;
		window.addEventListener("popstate", arrived, { once: true });
		window.history.back();
	}
	window.addEventListener("popstate", onBack);
	dialog.addEventListener("close", onClose);
}
