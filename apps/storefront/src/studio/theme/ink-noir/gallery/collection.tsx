import { useState } from "react";
import { Fill } from "../../../../intake/components/fill.tsx";
import { RouterAnchor } from "../../../components/router-anchor.tsx";
import {
	type GalleryPhotoView,
	type GalleryView,
	MAX_SEARCH,
	matchesSearch,
	type WorkSearch,
} from "../../../gallery.ts";
import { workHref } from "../../../links.ts";
import { type MoreWork, PagedGallery } from "../../../paging.tsx";
import { ArtworkRows } from "./artwork-card.tsx";
import { inkNoirGalleryCopy } from "./copy.ts";

const copy = inkNoirGalleryCopy;

/**
 * The collection: the search field right above the pieces it narrows, the
 * line that says what is showing, and the pieces themselves, a page at a time
 * (PagedGallery: "Show more" a link without JavaScript, read in place with
 * it, focus on the first new piece).
 *
 * The API has no text search, so the search runs here, on the pieces loaded
 * so far (matchesSearch: each word in the description, a style or the
 * artist's name): as the visitor types, at once, and with Search the text
 * goes into the address (`?q=`), so the view can be shared and the server
 * renders it. The status line says how many of the pieces shown match, and
 * when more remain that "Show more" searches further: it never claims the
 * whole collection was searched. The style, artist and healed filters are
 * the API's (GalleryFilters) and the search keeps them.
 */
export function ArtworkCollection({
	gallery,
	search,
	more,
}: {
	gallery: GalleryView;
	search: WorkSearch;
	more?: MoreWork;
}) {
	const [query, setQuery] = useState(search.q ?? "");
	const text = query.trim();
	return (
		<div className="ink-container ink-collection-wrap">
			{/* biome-ignore lint/a11y/useSemanticElements: a form with the search role is the pattern; <search> is not supported by the browsers we serve */}
			<form
				className="ink-gallery-search"
				role="search"
				aria-label={copy.search.label}
				method="get"
				action="/gallery"
			>
				{search.artist ? (
					<input type="hidden" name="artist" value={search.artist} />
				) : null}
				{search.style ? (
					<input type="hidden" name="style" value={search.style} />
				) : null}
				{search.healed ? <input type="hidden" name="healed" value="1" /> : null}
				<label className="ink-search-label" htmlFor="ink-gallery-q">
					{copy.search.field}
				</label>
				<input
					id="ink-gallery-q"
					className="ink-search-input"
					type="search"
					name="q"
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					maxLength={MAX_SEARCH}
					placeholder={copy.search.placeholder}
					autoComplete="off"
					enterKeyHint="search"
				/>
				<button type="submit" className="action ink-action-quiet">
					{copy.search.submit}
				</button>
			</form>
			<PagedGallery
				first={gallery}
				showArtist
				moreHref={(cursor) => workHref({ ...search, cursor })}
				more={more}
				renderPhotos={(photos, hasMore) => (
					<Matches
						photos={photos}
						query={text}
						hasMore={hasMore}
						clearHref={workHref({ ...search, q: undefined, cursor: undefined })}
					/>
				)}
			/>
		</div>
	);
}

/** What the search leaves of the pieces so far: the status line, then the rows or the empty search. */
function Matches({
	photos,
	query,
	hasMore,
	clearHref,
}: {
	photos: readonly GalleryPhotoView[];
	query: string;
	hasMore: boolean;
	clearHref: string;
}) {
	const shown = photos.filter((photo) => matchesSearch(photo, query));
	const n = photos.length;
	return (
		<>
			{/* biome-ignore lint/a11y/useSemanticElements: a polite live region for the count, not an <output> of a form */}
			<p className="ink-filter-status ink-collection-status" role="status">
				{query === "" ? (
					hasMore ? (
						<Fill template={copy.status.newest} values={{ n }} />
					) : n === 1 ? (
						copy.status.one
					) : (
						<Fill template={copy.status.all} values={{ n }} />
					)
				) : (
					<>
						<Fill
							template={copy.status.matches}
							values={{ m: shown.length, n, q: query }}
						/>
						{hasMore ? ` ${copy.status.more}` : null}
					</>
				)}
			</p>
			{shown.length > 0 ? (
				<ArtworkRows photos={shown} />
			) : (
				<div className="ink-work-empty">
					<p className="ink-work-empty-title">
						<Fill template={copy.empty.searched} values={{ q: query }} />
					</p>
					<p>
						<RouterAnchor
							className="ink-link"
							href={clearHref}
							resetScroll={false}
						>
							{copy.search.clear}
						</RouterAnchor>
					</p>
				</div>
			)}
		</>
	);
}
