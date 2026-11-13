import { Fill } from "../../../intake/components/fill.tsx";
import { RouterAnchor } from "../../components/router-anchor.tsx";
import type { Shell } from "../../components/shell.tsx";
import { studioCopy } from "../../copy.ts";
import { artistsHref } from "../../links.ts";
import type { ArtistsPageData } from "../../loaders.ts";
import { ArtistGrid } from "./artist-index.tsx";
import { flashParlourCopy } from "./copy.ts";
import { FlashParlourInvite } from "./invite.tsx";
import { PageHead } from "./page-head.tsx";
import { FlashParlourShell } from "./shell.tsx";

const copy = flashParlourCopy.artists;

/**
 * Flash Parlour's artists directory (`/artists`): the opening, the style filter
 * (links, `aria-current` on the chosen one, offered only while it can narrow
 * anything), every artist the filter keeps as a card on the wall, and the
 * closing invitation. The same data every theme gets (loadArtistsPage).
 */
export function FlashParlourArtistsPage({
	data,
	Shell = FlashParlourShell,
}: {
	data: ArtistsPageData;
	Shell?: Shell;
}) {
	const { studio, theme, directory } = data;
	const total = directory.artists.length;
	const current = directory.selected?.slug;
	return (
		<Shell
			studio={studio}
			theme={theme}
			requestLink={data.requestLink}
			chat={data.chat}
			page="artists"
			artistsShown={total > 0}
			mainClassName="fp-main fp-artists"
		>
			<PageHead
				label={copy.label}
				title={copy.title}
				line={
					total === 0 ? undefined : total === 1 ? (
						copy.lineOne
					) : (
						<Fill template={copy.lineMany} values={{ count: total }} />
					)
				}
			/>
			<div className="fp-container fp-section fp-artists-body">
				{directory.filterable ? (
					<nav className="fp-filters" aria-label={copy.filter}>
						{/* biome-ignore lint/a11y/useSemanticElements: it is a list; the role repairs WebKit's reading of list-style: none */}
						<ul
							className="fp-filter-list"
							// biome-ignore lint/a11y/noRedundantRoles: redundant for the spec, needed for WebKit with list-style: none
							role="list"
						>
							<li>
								<RouterAnchor
									className="fp-filter"
									href={artistsHref({})}
									aria-current={current === undefined ? "page" : undefined}
									resetScroll={false}
								>
									{copy.allStyles}
								</RouterAnchor>
							</li>
							{directory.styles.map((style) => (
								<li key={style.slug}>
									<RouterAnchor
										className="fp-filter"
										href={artistsHref({ style: style.slug })}
										aria-current={current === style.slug ? "page" : undefined}
										resetScroll={false}
									>
										{style.name}
									</RouterAnchor>
								</li>
							))}
						</ul>
					</nav>
				) : null}
				{total === 0 ? (
					<p className="fp-empty">{studioCopy.artistsEmpty}</p>
				) : directory.shown.length === 0 ? (
					<div className="fp-empty">
						<p>{copy.noMatch}</p>
						<p>
							<RouterAnchor className="fp-link" href={artistsHref({})}>
								{copy.showAll}
							</RouterAnchor>
						</p>
					</div>
				) : (
					<ArtistGrid artists={directory.shown} headingLevel={2} />
				)}
			</div>
			<FlashParlourInvite state={data.inquiry} link={data.ctaLink} />
		</Shell>
	);
}
