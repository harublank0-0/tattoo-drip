/*
 * The deposit page's DOM side (TAT-65b, spec ruling 13): the clipboard, and
 * the "I've paid" button's scroll (TAT-110). Node tests can't run it; the
 * browser pass checks Copy in Chrome and in an in-app browser (Instagram's,
 * Facebook's and Viber's often refuse the clipboard API), and the button's
 * scroll and focus.
 */

/**
 * Takes the client to step 3: its heading scrolls to the top of the screen
 * (smooth unless the visitor asked for less motion: styles.css decides) and
 * takes focus, so a screen reader starts reading there. It never touches the
 * URL: the token is in the fragment, and a link to "#proof-title" would
 * replace it.
 */
export function showProofStep(): void {
	const heading = document.getElementById("proof-title");
	if (!heading) return;
	heading.scrollIntoView({ block: "start" });
	heading.focus({ preventScroll: true });
}

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
