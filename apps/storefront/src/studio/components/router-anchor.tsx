import { type RegisteredRouter, useRouter } from "@tanstack/react-router";
import type { ComponentProps, MouseEvent } from "react";
import { keepFocusOn } from "../../navigation-focus.ts";

/** One of the page's own paths: "/…", never "//…" or "/\\…". */
const OWN_PATH = /^\/(?![/\\])/;

/**
 * Whether a click on a link may be taken over by the router: the main button
 * with no modifier key (a modifier asks the browser for a new tab or window,
 * or a download), on a page path of our own, not already handled.
 */
export function isRouterClick(
	event: Pick<
		MouseEvent,
		| "button"
		| "metaKey"
		| "altKey"
		| "ctrlKey"
		| "shiftKey"
		| "defaultPrevented"
	>,
	href: string,
): boolean {
	return (
		!event.defaultPrevented &&
		event.button === 0 &&
		!event.metaKey &&
		!event.altKey &&
		!event.ctrlKey &&
		!event.shiftKey &&
		OWN_PATH.test(href)
	);
}

/**
 * A plain `<a href>` (the markup, the server's render and a click without
 * JavaScript are exactly an anchor's) that the router takes over once the
 * page has hydrated: a click on one of the page's own paths becomes a
 * client-side navigation (`router.navigate({ href })`), with the router's
 * loaders, scroll restoration and fragment scrolling, instead of a full page
 * load. Outside a router (react-dom/server tests) it stays a plain anchor.
 * `href` comes from links.ts, like every other link on the page.
 */
export function RouterAnchor({
	href,
	onClick,
	resetScroll,
	...props
}: ComponentProps<"a"> & {
	href: string;
	/**
	 * False filters the page in place (the artists directory's styles): the
	 * scroll position stays, and so does focus, on this link
	 * (navigation-focus.ts). The router's default resets the scroll.
	 */
	resetScroll?: boolean;
}) {
	// The hook's type says a router is always there; outside one it is undefined.
	const router: RegisteredRouter | undefined = useRouter({ warn: false });
	return (
		<a
			{...props}
			href={href}
			onClick={(event) => {
				onClick?.(event);
				if (!router || !isRouterClick(event, href)) return;
				event.preventDefault();
				if (resetScroll === false) keepFocusOn(href);
				void router.navigate(
					resetScroll === undefined ? { href } : { href, resetScroll },
				);
			}}
		/>
	);
}
