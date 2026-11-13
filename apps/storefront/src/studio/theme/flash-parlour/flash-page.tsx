import { RouterAnchor } from "../../components/router-anchor.tsx";
import type { Shell } from "../../components/shell.tsx";
import { studioCopy } from "../../copy.ts";
import { flashHref } from "../../links.ts";
import type { FlashPageData } from "../../loaders.ts";
import { flashParlourCopy } from "./copy.ts";
import { FlashSheet } from "./flash-sheet.tsx";
import { FlashParlourInvite } from "./invite.tsx";
import { PageHead } from "./page-head.tsx";
import { FlashParlourShell } from "./shell.tsx";

const copy = flashParlourCopy.flash;

/** The first row on a phone, loaded at once; the rest lazily. */
const EAGER_SHEETS = 2;

/**
 * Flash Parlour's flash page (`/flash`): the whole wall. Its opening (the
 * page's h1, "Flash"), the artist filter (links, `aria-current` on the chosen
 * one, only while two or more artists have a design), then every shown
 * design newest first as a sheet on the wall (FlashSheet: the picture whole,
 * name, size, price or "Ask for a price", whose it is, "Request this design";
 * a claimed one greyed and stamped while the studio shows them), a page at a
 * time ("Show more" is a plain link to the next page, so it works without
 * JavaScript, and "Back to the newest" from a later one). Then the invitation
 * to bring an idea of one's own while the studio takes requests. The same
 * data every theme gets (loadFlashPage).
 */
export function FlashParlourFlashPage({
	data,
	Shell = FlashParlourShell,
}: {
	data: FlashPageData;
	Shell?: Shell;
}) {
	const { studio, theme, artists, search, list } = data;
	const filtered = search.artist !== undefined;
	const firstPage = filtered ? { artist: search.artist } : {};
	return (
		<Shell
			studio={studio}
			theme={theme}
			requestLink={data.requestLink}
			chat={data.chat}
			page="flash"
			artistsShown={artists.length > 0}
			mainClassName="fp-main fp-flash"
		>
			<PageHead
				label={copy.label}
				title={studioCopy.flash.pageTitle}
				titleId="flash-page-title"
				line={copy.line}
			/>
			<section
				className="fp-wall fp-wall-page"
				aria-labelledby="flash-page-title"
			>
				<div className="fp-container">
					{list.artists.length >= 2 ? (
						<nav className="fp-filters" aria-label={studioCopy.flash.filterNav}>
							{/* biome-ignore lint/a11y/useSemanticElements: it is a list; the role repairs WebKit's reading of list-style: none */}
							<ul
								className="fp-filter-list"
								// biome-ignore lint/a11y/noRedundantRoles: redundant for the spec, needed for WebKit with list-style: none
								role="list"
							>
								<li>
									<RouterAnchor
										className="fp-filter"
										href={flashHref({})}
										aria-current={filtered ? undefined : "page"}
									>
										{studioCopy.flash.all}
									</RouterAnchor>
								</li>
								{list.artists.map((artist) => (
									<li key={artist.slug}>
										<RouterAnchor
											className="fp-filter"
											href={flashHref({ artist: artist.slug })}
											aria-current={
												search.artist === artist.slug ? "page" : undefined
											}
										>
											<bdi>{artist.name}</bdi>
										</RouterAnchor>
									</li>
								))}
							</ul>
						</nav>
					) : null}
					{search.cursor !== undefined ? (
						<p className="work-newest">
							<RouterAnchor className="fp-link" href={flashHref(firstPage)}>
								{studioCopy.flash.newest}
							</RouterAnchor>
						</p>
					) : null}
					{list.designs.length > 0 ? (
						<>
							<FlashSheet
								designs={list.designs}
								artists={artists}
								eager={search.cursor === undefined ? EAGER_SHEETS : 0}
							/>
							{list.nextCursor !== null ? (
								<p className="fp-wall-all">
									<RouterAnchor
										className="fp-button"
										href={flashHref({ ...firstPage, cursor: list.nextCursor })}
									>
										{studioCopy.flash.showMore}
									</RouterAnchor>
								</p>
							) : null}
						</>
					) : (
						<div className="fp-empty">
							<p>
								{filtered ? studioCopy.flash.noMatch : studioCopy.flash.empty}
							</p>
							<p>
								{filtered ? (
									<RouterAnchor className="fp-link" href={flashHref({})}>
										{studioCopy.flash.showAll}
									</RouterAnchor>
								) : (
									<RouterAnchor className="fp-link" href="/">
										{studioCopy.goToStudio}
									</RouterAnchor>
								)}
							</p>
						</div>
					)}
				</div>
			</section>
			{data.requestLink ? (
				<FlashParlourInvite
					state={{ kind: "studio-closed", studioName: studio.name }}
					link={data.requestLink}
					line={copy.ask}
				/>
			) : null}
		</Shell>
	);
}
