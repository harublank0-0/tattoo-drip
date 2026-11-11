import { useEffect } from "react";
import type { ThemeKey } from "./theme/config.ts";
import { withPreviewParam } from "./theme/preview.ts";

/**
 * Keeps a theme preview (theme/preview.ts) on the links the browser itself
 * follows. Links the router takes over (RouterAnchor) keep it already: the
 * site context carries it from page to page. A plain `<a href>` (much of
 * Stencil & Ink's markup, a few links in the other themes) is a full load,
 * which starts again from the server and would end the preview; so while a
 * preview is on, a link about to be used (pressed, focused, or opened from
 * the context menu, which is how a new tab starts) gets `?preview=<theme>`
 * on its own address first. Only the page's own links, never a fragment on
 * this page, another origin, or one that already names a preview
 * (withPreviewParam). The components hold no DOM code: this is the one
 * island that does, and only while previewing.
 */
export function PreviewLinks({ theme }: { theme: ThemeKey }) {
	useEffect(() => {
		const keep = (event: Event) => {
			const target = event.target;
			if (!(target instanceof Element)) return;
			const link = target.closest("a[href]");
			if (!(link instanceof HTMLAnchorElement)) return;
			const href = withPreviewParam(
				link.getAttribute("href"),
				window.location.href,
				theme,
			);
			if (href !== null) link.setAttribute("href", href);
		};
		const events = ["pointerdown", "focusin", "contextmenu", "click"];
		for (const name of events) {
			document.addEventListener(name, keep, { capture: true });
		}
		return () => {
			for (const name of events) {
				document.removeEventListener(name, keep, { capture: true });
			}
		};
	}, [theme]);
	return null;
}
