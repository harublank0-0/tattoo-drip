import { studioCopy } from "../copy.ts";
import type { ThemeKey } from "../theme/config.ts";
import { THEME_NAMES } from "../theme/preview.ts";

/** What the preview is, in words: "Previewing Irezumi. Not saved: …". */
export function PreviewNotice({ theme }: { theme: ThemeKey }) {
	return (
		<>
			<strong>
				{studioCopy.preview.showing} {THEME_NAMES[theme]}.
			</strong>{" "}
			<span>{studioCopy.preview.notSaved}</span>
		</>
	);
}

/**
 * The theme preview's bar (theme/preview.ts): which theme this visit shows,
 * that nothing was saved, and the way out, a plain link to the same page and
 * query without the preview (a full load, so the preview ends). A slim bar
 * across the foot of the screen; the page keeps room for it below its end
 * and lifts the chat button above it (src/styles.css), so it covers nothing.
 * After the page in reading order, so the skip link stays the first stop;
 * the root says the same first, to a screen reader only. Words only from
 * this app: the theme's name comes from its key.
 */
export function PreviewBanner({
	theme,
	exitHref,
}: {
	theme: ThemeKey;
	/** The page's own path and query, without the preview (previewExitHref). */
	exitHref: string;
}) {
	return (
		<aside className="preview-banner" aria-label={studioCopy.preview.label}>
			<p>
				<PreviewNotice theme={theme} />
			</p>
			<a className="preview-banner-exit" href={exitHref}>
				{studioCopy.preview.exit}
			</a>
		</aside>
	);
}
