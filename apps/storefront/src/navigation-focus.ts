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
 * Only a new page counts: a new path. The first load is the browser's, a
 * change of fragment alone is a jump within the page, which the browser
 * handles, and a new query alone is the same page filtered (the artists
 * directory's style links), where focus stays on the filter just used. Nothing else on the
 * page navigates through the router ("Show more" and the photo viewer use
 * the history API directly), so this never takes focus from them.
 */

/** What `onResolved` says of a navigation (the router's NavigationEventInfo). */
export interface NavigationChange {
	readonly fromLocation?: unknown;
	readonly toLocation: { readonly hash: string };
	readonly pathChanged: boolean;
}

/** Whether this navigation showed a new page, so focus belongs to its content. Pure. */
export function movesFocus(change: NavigationChange): boolean {
	return change.fromLocation !== undefined && change.pathChanged;
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
		if (!movesFocus(event)) return;
		const ids = focusTargetIds(event.toLocation.hash);
		requestAnimationFrame(() =>
			requestAnimationFrame(() => {
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
