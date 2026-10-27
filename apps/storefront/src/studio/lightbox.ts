/**
 * Opens a work photo's viewer (TAT-116): the browser's own modal `<dialog>`,
 * which handles Escape, the first focus, the return of focus and the page
 * behind it. The one place the studio page touches the DOM, so only the
 * browser pass covers it; test/studio/lightbox.test.ts keeps it the only one.
 * Before the page hydrates, or without JavaScript, the photo buttons do
 * nothing and the grid is the content.
 */
export function showPhoto(id: string): void {
	const dialog = document.getElementById(id);
	if (dialog instanceof HTMLDialogElement && !dialog.open) dialog.showModal();
}
