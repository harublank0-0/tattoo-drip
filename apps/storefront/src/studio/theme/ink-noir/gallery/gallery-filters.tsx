import { RouterAnchor } from "../../../components/router-anchor.tsx";
import type { GalleryView, WorkSearch } from "../../../gallery.ts";
import { workHref } from "../../../links.ts";
import { inkNoirGalleryCopy } from "./copy.ts";

const copy = inkNoirGalleryCopy.filters;

/**
 * The collection's filters, next to the pieces they narrow: "All work" and
 * each style some photo carries (the API's own list: no style is offered that
 * shows nothing), the artist (a disclosure of the artists with photos, when
 * there is more than one, so a phone's row stays short), Healed only (when a
 * photo has healed) and Clear. Links, not buttons: each view is an address
 * that works without JavaScript and can be shared, and the router takes it
 * over once hydrated without moving the page (`resetScroll={false}`). Each
 * keeps the others and the search text; the page goes back to the newest.
 * The current one is `aria-current`, underlined, not only coloured.
 */
export function GalleryFilters({
	artists,
	gallery,
	search,
}: {
	artists: readonly { readonly slug: string; readonly name: string }[];
	gallery: GalleryView;
	search: WorkSearch;
}) {
	const { cursor: _page, ...kept } = search;
	const showHealed = gallery.healed || search.healed === true;
	const chosen = artists.find((artist) => artist.slug === search.artist);
	const filtered =
		search.style !== undefined ||
		search.artist !== undefined ||
		search.healed === true ||
		search.q !== undefined;
	return (
		<div className="ink-container ink-filters ink-gallery-filters">
			{gallery.styles.length > 0 ? (
				<nav className="ink-filter-bar" aria-label={copy.label}>
					{/* biome-ignore lint/a11y/useSemanticElements: it is a list; the role repairs WebKit's reading of list-style: none */}
					<ul
						className="ink-filter-list"
						// biome-ignore lint/a11y/noRedundantRoles: redundant for the spec, needed for WebKit with list-style: none
						role="list"
					>
						<li>
							<RouterAnchor
								className="ink-filter"
								href={workHref({ ...kept, style: undefined })}
								aria-current={search.style === undefined ? "page" : undefined}
								resetScroll={false}
							>
								{copy.all}
							</RouterAnchor>
						</li>
						{gallery.styles.map((style) => (
							<li key={style.slug}>
								<RouterAnchor
									className="ink-filter"
									href={workHref({ ...kept, style: style.slug })}
									aria-current={
										search.style === style.slug ? "page" : undefined
									}
									resetScroll={false}
								>
									{style.name}
								</RouterAnchor>
							</li>
						))}
					</ul>
				</nav>
			) : null}
			<div className="ink-gallery-more-filters">
				{artists.length > 1 || chosen ? (
					<details className="ink-artist-filter">
						<summary>
							<span>
								{copy.artist}: <bdi>{chosen?.name ?? copy.anyArtist}</bdi>
							</span>
						</summary>
						{/* biome-ignore lint/a11y/useSemanticElements: it is a list; the role repairs WebKit's reading of list-style: none */}
						<ul
							className="ink-artist-filter-list"
							// biome-ignore lint/a11y/noRedundantRoles: redundant for the spec, needed for WebKit with list-style: none
							role="list"
						>
							<li>
								<RouterAnchor
									href={workHref({ ...kept, artist: undefined })}
									aria-current={chosen ? undefined : "page"}
									resetScroll={false}
								>
									{copy.anyArtist}
								</RouterAnchor>
							</li>
							{artists.map((artist) => (
								<li key={artist.slug}>
									<RouterAnchor
										href={workHref({ ...kept, artist: artist.slug })}
										aria-current={
											chosen?.slug === artist.slug ? "page" : undefined
										}
										resetScroll={false}
									>
										<bdi>{artist.name}</bdi>
									</RouterAnchor>
								</li>
							))}
						</ul>
					</details>
				) : null}
				{showHealed ? (
					<RouterAnchor
						className="ink-filter ink-healed-filter"
						href={workHref({
							...kept,
							healed: search.healed === true ? undefined : true,
						})}
						aria-current={search.healed === true ? "page" : undefined}
						resetScroll={false}
					>
						{copy.healed}
					</RouterAnchor>
				) : null}
				{filtered ? (
					<RouterAnchor
						className="ink-link ink-clear-filters"
						href={workHref({})}
						resetScroll={false}
					>
						{copy.clear}
					</RouterAnchor>
				) : null}
			</div>
		</div>
	);
}
