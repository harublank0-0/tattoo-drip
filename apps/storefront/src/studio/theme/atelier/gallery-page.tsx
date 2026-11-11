import type { ReactNode } from "react";
import { RouterAnchor } from "../../components/router-anchor.tsx";
import type { Shell } from "../../components/shell.tsx";
import { studioCopy } from "../../copy.ts";
import type { WorkSearch } from "../../gallery.ts";
import { workHref } from "../../links.ts";
import type { WorkPageData } from "../../loaders.ts";
import { type MoreWork, PagedGallery } from "../../paging.tsx";
import { atelierCopy } from "./copy.ts";
import { AtelierInvite } from "./invite.tsx";
import { AtelierPieces } from "./pieces.tsx";
import { AtelierShell } from "./shell.tsx";

const copy = atelierCopy.gallery;

/**
 * Atelier's gallery (`/gallery`): the opening, the API's filters as links
 * (style, artist and healed; each keeps the others, and a page or search
 * text is dropped), then every piece whole, a page at a time (PagedGallery:
 * "Show more" a link without JavaScript, read in place with it), and the
 * invitation while someone takes new work. The same data every theme gets
 * (loadWorkPage). Atelier has no search box: a `q` in the address is kept
 * in "Back to the newest" only, and the pieces are the API's filters'.
 */
export function AtelierGalleryPage({
	data,
	more,
	Shell = AtelierShell,
}: {
	data: WorkPageData;
	more?: MoreWork;
	Shell?: Shell;
}) {
	const { studio, theme, artists, search, gallery } = data;
	const filters: WorkSearch = {
		...(search.artist ? { artist: search.artist } : {}),
		...(search.style ? { style: search.style } : {}),
		...(search.healed ? { healed: true as const } : {}),
	};
	const filtered = Object.keys(filters).length > 0;
	const showHealed = gallery.healed || search.healed === true;
	return (
		<Shell
			studio={studio}
			theme={theme}
			requestLink={data.requestLink}
			chat={data.chat}
			page="work"
			artistsShown={data.hasArtists}
			mainClassName="atl-main atl-gallery"
		>
			<header className="atl-page-head">
				<div className="atl-container">
					<p className="atl-kicker">{copy.label}</p>
					<h1 className="atl-page-title">{copy.title}</h1>
					<p className="atl-page-line">{copy.line}</p>
				</div>
			</header>
			<section className="atl-section atl-container" aria-label={copy.label}>
				{gallery.styles.length > 0 ||
				artists.length > 1 ||
				showHealed ||
				filtered ? (
					<nav className="atl-filters" aria-label={copy.filters}>
						{gallery.styles.length > 0 || search.style ? (
							<FilterRow label={copy.style}>
								<Filter
									href={workHref({ ...filters, style: undefined })}
									current={!search.style}
								>
									{copy.allStyles}
								</Filter>
								{gallery.styles.map((style) => (
									<Filter
										key={style.slug}
										href={workHref({ ...filters, style: style.slug })}
										current={search.style === style.slug}
									>
										{style.name}
									</Filter>
								))}
							</FilterRow>
						) : null}
						{artists.length > 1 || search.artist ? (
							<FilterRow label={copy.artist}>
								<Filter
									href={workHref({ ...filters, artist: undefined })}
									current={!search.artist}
								>
									{copy.allArtists}
								</Filter>
								{artists.map((artist) => (
									<Filter
										key={artist.slug}
										href={workHref({ ...filters, artist: artist.slug })}
										current={search.artist === artist.slug}
									>
										<bdi>{artist.name}</bdi>
									</Filter>
								))}
							</FilterRow>
						) : null}
						{showHealed ? (
							<FilterRow label={studioCopy.work.filterNav}>
								<Filter
									href={workHref({ ...filters, healed: undefined })}
									current={search.healed !== true}
								>
									{studioCopy.work.all}
								</Filter>
								<Filter
									href={workHref({ ...filters, healed: true })}
									current={search.healed === true}
								>
									{copy.healed}
								</Filter>
							</FilterRow>
						) : null}
					</nav>
				) : null}
				{search.cursor !== undefined ? (
					<p className="work-newest">
						<RouterAnchor
							className="atl-link"
							href={workHref({ ...filters, q: search.q })}
						>
							{studioCopy.work.newest}
						</RouterAnchor>
					</p>
				) : null}
				{gallery.photos.length > 0 ? (
					<PagedGallery
						key={workHref(search)}
						first={gallery}
						showArtist
						moreHref={(cursor) => workHref({ ...search, cursor })}
						more={more}
						renderPhotos={(photos) => (
							<AtelierPieces photos={photos} eagerFirst />
						)}
					/>
				) : (
					<div className="atl-empty">
						<p>{filtered ? copy.filtered : copy.empty}</p>
						{filtered ? (
							<p>
								<RouterAnchor className="atl-link" href={workHref({})}>
									{copy.showAll}
								</RouterAnchor>
							</p>
						) : null}
					</div>
				)}
			</section>
			{data.requestLink ? (
				<AtelierInvite
					state={{ kind: "studio-closed", studioName: studio.name }}
					link={data.requestLink}
					line={copy.ask}
				/>
			) : null}
		</Shell>
	);
}

function FilterRow({
	label,
	children,
}: {
	label: string;
	children: ReactNode;
}) {
	return (
		<div className="atl-filter-row">
			<p className="atl-filter-label" aria-hidden="true">
				{label}
			</p>
			{/* biome-ignore lint/a11y/useSemanticElements: it is a list; the role repairs WebKit's reading of list-style: none */}
			<ul
				className="atl-filter-list"
				// biome-ignore lint/a11y/noRedundantRoles: redundant for the spec, needed for WebKit with list-style: none
				role="list"
				aria-label={label}
			>
				{children}
			</ul>
		</div>
	);
}

function Filter({
	href,
	current,
	children,
}: {
	href: string;
	current: boolean;
	children: ReactNode;
}) {
	return (
		<li>
			<RouterAnchor
				className="atl-filter"
				href={href}
				aria-current={current ? "page" : undefined}
			>
				{children}
			</RouterAnchor>
		</li>
	);
}
