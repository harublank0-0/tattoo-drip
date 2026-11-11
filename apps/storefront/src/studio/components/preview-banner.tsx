import { studioCopy } from "../copy.ts";
import type { ThemeKey } from "../theme/config.ts";
import { THEME_NAMES } from "../theme/preview.ts";

/**
 * The theme preview's notice (theme/preview.ts): which theme this visit
 * shows, that nothing was saved, and the way out, a plain link to the same
 * page without the preview (a full load, so the preview ends). It sits at
 * the foot of the screen at the start edge, after the page in reading order,
 * so the page's skip link stays the first stop for the keyboard. Words only
 * from this app: the theme's name comes from its key.
 */
export function PreviewBanner({
	theme,
	exitHref,
}: {
	theme: ThemeKey;
	/** The page's own path, without the preview. */
	exitHref: string;
}) {
	return (
		<aside className="preview-banner" aria-label={studioCopy.preview.label}>
			<p>
				<strong>
					{studioCopy.preview.showing} {THEME_NAMES[theme]}
				</strong>{" "}
				<span>{studioCopy.preview.notSaved}</span>
			</p>
			<a className="preview-banner-exit" href={exitHref}>
				{studioCopy.preview.exit}
			</a>
		</aside>
	);
}
