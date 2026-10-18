/*
 * The deposit page's DOM side (TAT-65b, spec ruling 13): the clipboard.
 * Node tests can't run it; the browser pass checks Copy in Chrome and in an
 * in-app browser (Instagram's, Facebook's and Viber's often refuse the
 * clipboard API).
 */

/** Copies `text`; false when neither the clipboard API nor the old way worked. */
export async function copyText(text: string): Promise<boolean> {
	try {
		if (navigator.clipboard?.writeText) {
			await navigator.clipboard.writeText(text);
			return true;
		}
	} catch {
		// Refused (an in-app browser, or no permission): the old way below.
	}
	const active = document.activeElement;
	const area = document.createElement("textarea");
	area.value = text;
	area.setAttribute("readonly", "");
	area.className = "sr-only";
	document.body.append(area);
	try {
		area.select();
		area.setSelectionRange(0, text.length);
		return document.execCommand("copy");
	} catch {
		return false;
	} finally {
		area.remove();
		if (active instanceof HTMLElement) active.focus();
	}
}
