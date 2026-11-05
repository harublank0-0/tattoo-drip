import type { AnyRouter } from "@tanstack/react-router";

/**
 * Focus after a client-side navigation. A link the router takes over
 * (RouterAnchor: Ink Noir's header, menu, footer and home page) swaps the page
 * without a page load, so the browser neither resets focus nor tells a screen
 * reader that a new page is there: the focused link is unmounted with the old
 * page and focus falls to `<body>`. After each such navigation focus moves to
 * the new page's content, as a page load would start there: the fragment's
 * target when the address names one (`/#artists`), else `<main id="main">`
 * (Ink Noir's, `tabIndex={-1}`), else the page's first `<main>`. Without moving the page: the router's own
 * scroll restoration and fragment scrolling stay in charge of that.
 *
 * A new path moves it, and so does a new query (a filtered /work, or a nav
 * link from one): the content changed and the router reset the scroll. The
 * first load is the browser's, and a change of fragment alone is a jump
 * within the page, which the browser handles. One exception: a link that
 * filters the page in place (RouterAnchor with `resetScroll={false}`, the
 * artists directory's styles) calls keepFocusOn(href) first, and focus stays
 * on it, unless the link went away with the old content ("Show all
 * artists"), in which case focus goes to the content as usual. Nothing else on
 * the page navigates through the router ("Show more" and the photo viewer use
 * the history API directly), so this never takes focus from them.
 */

/** What `onResolved` says of a navigation (the router's NavigationEventInfo). */
export interface NavigationChange {
	readonly fromLocation?: { readonly searchStr: string };
	readonly toLocation: {
		readonly href: string;
		readonly searchStr: string;
		readonly hash: string;
	};
	readonly pathChanged: boolean;
}

/**
 * What to do with focus after this navigation. Pure. "move": to the new
 * content. "keep": leave it on the link that filtered the page in place, if
 * that link is still there (else move). "none": the browser's business.
 */
export function focusAction(
	change: NavigationChange,
	keptHref: string | null,
): "move" | "keep" | "none" {
	if (!change.fromLocation) return "none";
	if (change.pathChanged) return "move";
	if (change.fromLocation.searchStr === change.toLocation.searchStr) {
		return "none";
	}
	return keptHref === change.toLocation.href ? "keep" : "move";
}

/** The address a filter link is opening in place; read and cleared by the next navigation. */
let keptHref: string | null = null;

/**
 * Called by a link that changes only the page's query in place, just before
 * the router navigates to `href`: focus stays on that link (focusAction).
 * Browser only: set by a click, never during a render.
 */
export function keepFocusOn(href: string): void {
	keptHref = href;
}

/** The id to focus: the fragment's target when there is one, else the page's `<main>`. Pure. */
export function focusTargetIds(hash: string): readonly string[] {
	return hash === "" ? ["main"] : [hash, "main"];
}

/**
 * Moves focus as above after every page change of this router. Browser only;
 * returns the unsubscribe. Waits two frames, so React has committed the new
 * page and the old one's cleanups (a closing menu returning focus to its
 * button) have run first.
 */
export function focusAfterNavigation(router: AnyRouter): () => void {
	return router.subscribe("onResolved", (event) => {
		const action = focusAction(event, keptHref);
		keptHref = null;
		if (action === "none") return;
		const ids = focusTargetIds(event.toLocation.hash);
		requestAnimationFrame(() =>
			requestAnimationFrame(() => {
				const current = document.activeElement;
				// The filter link is still on the page with focus on it: leave it there.
				if (
					action === "keep" &&
					current !== null &&
					current !== document.body &&
					current.isConnected
				) {
					return;
				}
				// Stencil & Ink's and the status pages' <main> has no id: the first <main> then.
				const target =
					ids
						.map((id) => document.getElementById(id))
						.find((element) => element !== null) ??
					document.querySelector("main");
				if (!target) return;
				// A section is not focusable by itself: -1 lets focus land without adding a tab stop.
				if (!target.hasAttribute("tabindex")) {
					target.setAttribute("tabindex", "-1");
				}
				target.focus({ preventScroll: true });
			}),
		);
	});
}
