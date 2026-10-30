import { type MouseEvent, useEffect, useState } from "react";
import { GalleryGrid } from "./components/gallery.tsx";
import { studioCopy } from "./copy.ts";
import type { GalleryView } from "./gallery.ts";

/**
 * "Show more" (TAT-126), the gallery's one stateful island. The components
 * under src/studio/components hold no state and no DOM code (a test keeps them
 * so), so the photos so far, the next cursor and the focus move live here.
 *
 * Without JavaScript, or before the page hydrates, "Show more" is a plain
 * link to the next page (`moreHref`: the same filters and the cursor). With
 * `more`, a click reads that page in place instead and appends it; a failure
 * leaves the link to try again, or to follow.
 */

/** The page after `cursor`, numbered on from `offset` photos (the browser's read: loaders.ts moreWork). */
export type MoreWork = (cursor: string, offset: number) => Promise<GalleryView>;

type Status = "idle" | "loading" | "failed";

export function PagedGallery({
	first,
	showArtist,
	moreHref,
	more,
}: {
	/** The page the server rendered. */
	first: GalleryView;
	showArtist: boolean;
	/** Where "Show more" goes without JavaScript. */
	moreHref: (cursor: string) => string;
	more?: MoreWork;
}) {
	const [photos, setPhotos] = useState(first.photos);
	const [cursor, setCursor] = useState(first.nextCursor);
	const [status, setStatus] = useState<Status>("idle");
	const [focusId, setFocusId] = useState<string | null>(null);

	// The photos just added are below the link that was clicked: put the
	// keyboard on the first of them, or it would be left on the link.
	useEffect(() => {
		if (focusId) document.getElementById(focusId)?.focus();
	}, [focusId]);

	async function showMore(event: MouseEvent<HTMLAnchorElement>) {
		// A new tab, window or download is the link's own business.
		if (event.button !== 0 || event.metaKey || event.ctrlKey) return;
		if (event.shiftKey || event.altKey || !more || cursor === null) return;
		event.preventDefault();
		if (status === "loading") return;
		setStatus("loading");
		try {
			const next = await more(cursor, photos.length);
			setPhotos((shown) => [...shown, ...next.photos]);
			setCursor(next.nextCursor);
			setStatus("idle");
			if (next.photos.length > 0) setFocusId(next.photos[0].openId);
		} catch {
			setStatus("failed");
		}
	}

	return (
		<>
			<GalleryGrid photos={photos} showArtist={showArtist} />
			{cursor !== null ? (
				<div className="work-more-bar">
					<a
						className="action action-secondary work-more"
						href={moreHref(cursor)}
						aria-busy={status === "loading" ? true : undefined}
						onClick={showMore}
					>
						{status === "loading"
							? studioCopy.work.loadingMore
							: studioCopy.work.showMore}
					</a>
					{/* Always there, so a screen reader hears the words when they arrive. */}
					{/* biome-ignore lint/a11y/useSemanticElements: a status line is not what <output> (a form's calculated result) means */}
					<p role="status" className={status === "failed" ? "note" : undefined}>
						{status === "failed" ? studioCopy.work.moreFailed : null}
					</p>
				</div>
			) : null}
		</>
	);
}
