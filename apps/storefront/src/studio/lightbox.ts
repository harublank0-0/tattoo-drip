/**
 * Opens a work photo's viewer (TAT-116): the browser's own modal `<dialog>`,
 * which handles Escape, the first focus, the return of focus and the page
 * behind it. The one place the studio page touches the DOM, so only the
 * browser pass covers it (and test/studio/lightbox-guard.test.ts, with the
 * DOM stood in); test/studio/lightbox.test.ts keeps it the only one. Before
 * the page hydrates, or without JavaScript, the photo buttons do nothing and
 * the grid is the content.
 *
 * Where `<dialog>` is not supported (iOS before 15.4, Firefox before 98, old
 * WebViews) there is no viewer: the photo itself opens in its own page (the
 * large image's address was checked with the page's data), and the back
 * button returns to the studio page. The stylesheet hides the unopened dialogs
 * there, so the grid is all that shows.
 */
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
	if (!dialog.open) dialog.showModal();
}
