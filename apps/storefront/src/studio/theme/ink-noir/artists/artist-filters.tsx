import { Fill } from "../../../../intake/components/fill.tsx";
import type { ArtistsDirectory } from "../../../artists.ts";
import { RouterAnchor } from "../../../components/router-anchor.tsx";
import { artistsHref } from "../../../links.ts";
import { inkNoirArtistsCopy } from "./copy.ts";

const copy = inkNoirArtistsCopy.filters;

/**
 * The style filter: "All" and each style an artist lists, with how many do.
 * Links, not buttons: each filter is an address (`/artists?style=<slug>`) that
 * works without JavaScript, can be shared, and that the router takes over once
 * hydrated without moving the page (`resetScroll={false}`; focus stays on the
 * link, navigation-focus.ts). The current one is `aria-current="page"` and
 * underlined, not only coloured. The row scrolls sideways inside itself on a
 * phone, never the page. Under it a status line (`role="status"`, so a screen
 * reader hears the new count) says what the filter shows.
 */
export function ArtistFilters({ directory }: { directory: ArtistsDirectory }) {
	const current = directory.selected?.slug;
	const total = directory.artists.length;
	return (
		<div className="ink-container ink-filters">
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
							href={artistsHref({})}
							aria-current={current === undefined ? "page" : undefined}
							resetScroll={false}
						>
							<span>{copy.all}</span>
							<span className="ink-filter-count" aria-hidden="true">
								{total}
							</span>
						</RouterAnchor>
					</li>
					{directory.styles.map((style) => (
						<li key={style.slug}>
							<RouterAnchor
								className="ink-filter"
								href={artistsHref({ style: style.slug })}
								aria-current={current === style.slug ? "page" : undefined}
								resetScroll={false}
							>
								<span>{style.name}</span>
								<span className="ink-filter-count" aria-hidden="true">
									{style.count}
								</span>
							</RouterAnchor>
						</li>
					))}
				</ul>
			</nav>
			{/* biome-ignore lint/a11y/useSemanticElements: a polite live region for the count, not an <output> of a form */}
			<p className="ink-filter-status" role="status">
				{directory.selected === null ? (
					<Fill template={copy.showingAll} values={{ total }} />
				) : directory.selected.name === null ? (
					<Fill
						template={copy.showingCount}
						values={{ shown: directory.shown.length, total }}
					/>
				) : (
					<Fill
						template={copy.showingStyle}
						values={{
							style: directory.selected.name,
							shown: directory.shown.length,
							total,
						}}
					/>
				)}
			</p>
		</div>
	);
}
