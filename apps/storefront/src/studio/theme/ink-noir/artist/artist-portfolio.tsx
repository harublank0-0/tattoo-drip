import { HealedFilter } from "../../../components/gallery.tsx";
import { RouterAnchor } from "../../../components/router-anchor.tsx";
import { studioCopy } from "../../../copy.ts";
import type { GalleryView, PortfolioSearch } from "../../../gallery.ts";
import {
	isAllowedHref,
	linkRel,
	portfolioHref,
	workHref,
} from "../../../links.ts";
import { type MoreWork, PagedGallery } from "../../../paging.tsx";
import type { ArtistView } from "../../../view-model.ts";
import { SectionHead } from "../home/parts.tsx";
import { inkNoirArtistCopy } from "./copy.ts";
import { portfolioSizes } from "./sizes.ts";

const copy = inkNoirArtistCopy.portfolio;

/**
 * The artist's whole portfolio, a page at a time: the shared paged gallery
 * (PagedGallery: "Show more" a link without JavaScript, the browser's
 * `<dialog>` viewer for each photo, its tested focus moves), each photo drawn
 * whole in a square cell (artist.css), so a tattoo is never cut to fit. The All / Healed links and "Back to the newest" are the shared
 * page's, and so is the `work` id every portfolio link carries. With no
 * photos it says there are none to show (a failed read looks the same, so it
 * claims nothing more) and points to the artist's Instagram when they have
 * one. The full gallery, filtered by this artist, is a link away.
 */
export function ArtistPortfolio({
	artist,
	gallery,
	search,
	more,
}: {
	artist: ArtistView;
	gallery: GalleryView;
	search: PortfolioSearch;
	more?: MoreWork;
}) {
	const healed = search.healed === true;
	const filter = healed ? { healed: true as const } : {};
	const slug = artist.slug;
	const instagram = artist.links.find(
		(link) => link.kind === "instagram" && isAllowedHref(link.href),
	);
	const empty = gallery.photos.length === 0;
	return (
		<section
			id="work"
			className="ink-section ink-portfolio"
			aria-labelledby="work-title"
		>
			<div className="ink-container">
				<div className="ink-work-head">
					<SectionHead id="work-title" label={copy.label}>
						{copy.title}
					</SectionHead>
					{!empty ? (
						<RouterAnchor
							className="ink-link"
							href={workHref({ artist: slug })}
						>
							{copy.allWork}
						</RouterAnchor>
					) : null}
				</div>
				{gallery.healed || healed ? (
					<HealedFilter
						allHref={portfolioHref(slug, {})}
						healedHref={portfolioHref(slug, { healed: true })}
						healed={healed}
					/>
				) : null}
				{search.cursor !== undefined ? (
					<p className="work-newest">
						<a className="text-link" href={portfolioHref(slug, filter)}>
							{studioCopy.work.newest}
						</a>
					</p>
				) : null}
				{!empty ? (
					<PagedGallery
						key={portfolioHref(slug, search)}
						first={gallery}
						showArtist={false}
						moreHref={(cursor) => portfolioHref(slug, { ...filter, cursor })}
						more={more}
						sizes={portfolioSizes}
					/>
				) : (
					<div className="ink-work-empty">
						<p className="ink-work-empty-title">
							{healed ? studioCopy.work.noHealed : copy.empty}
						</p>
						{instagram && !healed ? (
							<p>
								<a
									className="ink-link"
									href={instagram.href}
									rel={linkRel(instagram.href)}
								>
									{copy.follow}
								</a>
							</p>
						) : null}
					</div>
				)}
			</div>
		</section>
	);
}
