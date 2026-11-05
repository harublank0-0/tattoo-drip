import { RouterAnchor } from "../../../components/router-anchor.tsx";
import type { Shell } from "../../../components/shell.tsx";
import { studioCopy } from "../../../copy.ts";
import { isAllowedHref, workHref } from "../../../links.ts";
import type { WorkPageData } from "../../../loaders.ts";
import type { MoreWork } from "../../../paging.tsx";
import { Lines } from "../home/parts.tsx";
import { InkNoirShell } from "../shell.tsx";
import { ArtworkCollection } from "./collection.tsx";
import { inkNoirGalleryCopy } from "./copy.ts";
import { GalleryFilters } from "./gallery-filters.tsx";
import { GalleryIntro } from "./gallery-intro.tsx";

const copy = inkNoirGalleryCopy;

/**
 * Ink Noir's gallery (`/gallery`): the studio's work as an exhibition. The
 * opening, the filters by the pieces they narrow, the search, and the pieces
 * in justified rows, each whole and a link to its own page; then the
 * invitation to ask about a piece while someone takes new work. The same data
 * every theme gets (loadWorkPage); props only but for the collection's search
 * and "Show more" (collection.tsx).
 */
export function InkNoirGalleryPage({
	data,
	more,
	Shell = InkNoirShell,
}: {
	data: WorkPageData;
	/** The browser's "Show more"; without it the link loads the next page. */
	more?: MoreWork;
	Shell?: Shell;
}) {
	const { studio, theme, artists, search, gallery } = data;
	const { cursor: _page, q: _text, ...filters } = search;
	const filtered = Boolean(
		search.artist || search.style || search.healed === true,
	);
	const request = data.requestLink;
	return (
		<Shell
			studio={studio}
			theme={theme}
			requestLink={request}
			chat={data.chat}
			page="work"
			artistsShown={data.hasArtists}
			mainClassName="ink-home ink-gallery-page"
		>
			<GalleryIntro studio={studio} />
			<section className="ink-gallery" aria-label={copy.intro.label}>
				<GalleryFilters artists={artists} gallery={gallery} search={search} />
				{search.cursor !== undefined ? (
					<p className="ink-container work-newest">
						<RouterAnchor
							className="ink-link"
							href={workHref({ ...filters, q: search.q })}
						>
							{studioCopy.work.newest}
						</RouterAnchor>
					</p>
				) : null}
				{gallery.photos.length > 0 ? (
					<ArtworkCollection
						key={workHref(search)}
						gallery={gallery}
						search={search}
						more={more}
					/>
				) : (
					<div className="ink-container ink-work-empty">
						<p className="ink-work-empty-title">
							{filtered ? copy.empty.filtered : copy.empty.title}
						</p>
						{filtered ? (
							<p>
								<RouterAnchor className="ink-link" href={workHref({})}>
									{copy.empty.showAll}
								</RouterAnchor>
							</p>
						) : (
							<p>{copy.empty.line}</p>
						)}
					</div>
				)}
			</section>
			{request && isAllowedHref(request.href) ? (
				<section
					className="ink-section ink-close ink-gallery-close"
					aria-labelledby="gallery-close-title"
				>
					<div className="ink-container ink-close-grid">
						<h2 id="gallery-close-title" className="ink-close-title">
							<Lines lines={copy.close.lines} />
						</h2>
						<div className="ink-close-body">
							<p className="ink-close-line">{copy.close.line}</p>
							<div className="ink-hero-actions">
								<RouterAnchor
									className="action action-primary ink-cta"
									href={request.href}
								>
									{copy.piece.artist.request}
								</RouterAnchor>
							</div>
						</div>
					</div>
				</section>
			) : null}
		</Shell>
	);
}
