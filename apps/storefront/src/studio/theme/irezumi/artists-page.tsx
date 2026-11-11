import { Fill } from "../../../intake/components/fill.tsx";
import { RouterAnchor } from "../../components/router-anchor.tsx";
import type { Shell } from "../../components/shell.tsx";
import { studioCopy } from "../../copy.ts";
import { artistsHref } from "../../links.ts";
import type { ArtistsPageData } from "../../loaders.ts";
import { ArtistIndex } from "./artist-index.tsx";
import { irezumiCopy } from "./copy.ts";
import { IrezumiInvite } from "./invite.tsx";
import { IrezumiShell } from "./shell.tsx";

const copy = irezumiCopy.artists;

/**
 * Irezumi's artists directory (`/artists`): the opening, the style filter
 * (links, `aria-current` on the chosen one, offered only while it can narrow
 * anything), every artist the filter keeps as an index entry, and the
 * closing invitation. The same data every theme gets (loadArtistsPage).
 */
export function IrezumiArtistsPage({
	data,
	Shell = IrezumiShell,
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
			mainClassName="irz-main irz-artists"
		>
			<header className="irz-page-head">
				<div className="irz-container">
					<p className="irz-kicker">{copy.label}</p>
					<h1 className="irz-page-title">{copy.title}</h1>
					{total > 0 ? (
						<p className="irz-page-line">
							{total === 1 ? (
								copy.lineOne
							) : (
								<Fill template={copy.lineMany} values={{ count: total }} />
							)}
						</p>
					) : null}
				</div>
			</header>
			<div className="irz-container irz-section irz-artists-body">
				{directory.filterable ? (
					<nav className="irz-filters" aria-label={copy.filter}>
						{/* biome-ignore lint/a11y/useSemanticElements: it is a list; the role repairs WebKit's reading of list-style: none */}
						<ul
							className="irz-filter-list"
							// biome-ignore lint/a11y/noRedundantRoles: redundant for the spec, needed for WebKit with list-style: none
							role="list"
						>
							<li>
								<RouterAnchor
									className="irz-filter"
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
										className="irz-filter"
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
					<p className="irz-empty">{studioCopy.artistsEmpty}</p>
				) : directory.shown.length === 0 ? (
					<div className="irz-empty">
						<p>{copy.noMatch}</p>
						<p>
							<RouterAnchor className="irz-link" href={artistsHref({})}>
								{copy.showAll}
							</RouterAnchor>
						</p>
					</div>
				) : (
					<ArtistIndex artists={directory.shown} headingLevel={2} />
				)}
			</div>
			<IrezumiInvite state={data.inquiry} link={data.ctaLink} />
		</Shell>
	);
}
