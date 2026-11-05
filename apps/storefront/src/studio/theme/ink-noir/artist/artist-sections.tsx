import { Fill } from "../../../../intake/components/fill.tsx";
import { RouterAnchor } from "../../../components/router-anchor.tsx";
import { BookingCta } from "../../../components/storefront.tsx";
import { studioCopy } from "../../../copy.ts";
import { artistsHref, isAllowedHref, workHref } from "../../../links.ts";
import type { NeighbourArtist } from "../../../loaders.ts";
import type { RequestLink } from "../../../request.ts";
import type { ArtistView, StudioView } from "../../../view-model.ts";
import { Lines, SectionHead } from "../home/parts.tsx";
import { inkNoirArtistCopy } from "./copy.ts";

const copy = inkNoirArtistCopy;

/**
 * About the artist: their own bio, set large as the feature's opening.
 * Nothing when they wrote none: no philosophy, quote or experience is made up
 * (the data has none of them).
 */
export function ArtistAbout({ artist }: { artist: ArtistView }) {
	if (!artist.bio) return null;
	return (
		<section
			id="about"
			className="ink-section ink-artist-about"
			aria-labelledby="about-title"
		>
			<div className="ink-container ink-artist-about-grid">
				<SectionHead id="about-title" label={copy.about.label}>
					{copy.about.title}
				</SectionHead>
				<p className="ink-artist-bio-lead user-text" dir="auto">
					{artist.bio}
				</p>
			</div>
		</section>
	);
}

/**
 * The styles the artist lists, as large names on hairlines, each a link to
 * the gallery filtered by that style and this artist (`/work?artist=&style=`,
 * which /work already reads). Nothing when they list none.
 */
export function ArtistSpecialties({
	artist,
	styles,
}: {
	artist: ArtistView;
	styles: readonly { readonly slug: string; readonly name: string }[];
}) {
	if (styles.length === 0) return null;
	return (
		<section
			id="styles"
			className="ink-section ink-styles"
			aria-labelledby="styles-title"
		>
			<div className="ink-container ink-styles-grid">
				<SectionHead id="styles-title" label={copy.specialties.label}>
					{copy.specialties.title}
				</SectionHead>
				{/* biome-ignore lint/a11y/useSemanticElements: it is a list; the role repairs WebKit's reading of list-style: none */}
				<ul
					className="ink-style-list"
					// biome-ignore lint/a11y/noRedundantRoles: redundant for the spec, needed for WebKit with list-style: none
					role="list"
				>
					{styles.map((style) => {
						const href = workHref({ artist: artist.slug, style: style.slug });
						return (
							<li key={style.slug} className="ink-style">
								<h3 className="ink-style-name" dir="auto">
									{isAllowedHref(href) ? (
										<RouterAnchor
											className="ink-style-link"
											href={href}
											aria-label={copy.specialties.seeWork
												.replace("{style}", style.name)
												.replace("{name}", artist.name)}
										>
											{style.name}
										</RouterAnchor>
									) : (
										style.name
									)}
								</h3>
							</li>
						);
					})}
				</ul>
			</div>
		</section>
	);
}

/**
 * The invitation to book: "Start your next piece.", whether the artist takes
 * new work (their own switch; never an invented availability), and the
 * request: this artist's form while they take new work, else the studio's
 * general one while it is open, else none (the page's `requestLink`). The
 * four booking steps follow while there is someone to ask. The `inquiry` id
 * keeps old `/artists/<slug>#inquiry` links landing here.
 */
export function ArtistBooking({
	artist,
	studio,
	requestLink,
}: {
	artist: ArtistView;
	studio: StudioView;
	requestLink: RequestLink | null;
}) {
	const open = requestLink !== null && isAllowedHref(requestLink.href);
	return (
		<section
			id="inquiry"
			className="ink-section ink-close"
			aria-labelledby="inquiry-title"
		>
			<div className="ink-container ink-close-grid">
				<p className="ink-label">{copy.booking.label}</p>
				<h2 id="inquiry-title" className="ink-close-title">
					<Lines lines={copy.booking.lines} />
				</h2>
				<div className="ink-close-body">
					<p className="ink-close-line">
						{artist.accepting ? (
							<Fill
								template={copy.booking.open}
								values={{ name: artist.name }}
							/>
						) : artist.closedMessage ? (
							<span className="user-text" dir="auto">
								{artist.closedMessage}
							</span>
						) : (
							<Fill
								template={copy.booking.closed}
								values={{ name: artist.name }}
							/>
						)}
					</p>
					{open ? (
						<>
							<p className="ink-close-detail">
								{artist.accepting ? (
									<Fill
										template={copy.booking.line}
										values={{ name: artist.name }}
									/>
								) : (
									<Fill
										template={copy.booking.studioOpen}
										values={{ studio: studio.name }}
									/>
								)}
							</p>
							{/* biome-ignore lint/a11y/useSemanticElements: it is a list; the role repairs WebKit's reading of list-style: none */}
							<ol
								className="ink-steps"
								// biome-ignore lint/a11y/noRedundantRoles: redundant for the spec, needed for WebKit with list-style: none
								role="list"
								aria-label={studioCopy.booking.title}
							>
								{studioCopy.booking.steps.map((step) => (
									<li key={step.title}>{step.title}</li>
								))}
							</ol>
						</>
					) : null}
					<div className="ink-close-actions">
						{open ? (
							<BookingCta link={requestLink} className="ink-cta" />
						) : null}
						<RouterAnchor
							className="action ink-action-quiet"
							href={artistsHref({})}
						>
							{copy.neighbours.all}
						</RouterAnchor>
					</div>
				</div>
			</div>
		</section>
	);
}

/**
 * The way on: the previous and next artist in the directory's order (none at
 * either end, and nothing for a lone artist), each with their name.
 */
export function ArtistNeighbours({
	previous,
	next,
}: {
	previous: NeighbourArtist | null;
	next: NeighbourArtist | null;
}) {
	const items = (
		[
			["previous", copy.neighbours.previous, previous],
			["next", copy.neighbours.next, next],
		] as const
	).flatMap(([key, label, artist]) =>
		artist && isAllowedHref(artist.href) ? [{ key, label, artist }] : [],
	);
	if (items.length === 0) return null;
	return (
		<nav
			className="ink-container ink-neighbours"
			aria-label={copy.neighbours.label}
		>
			{items.map((item) => (
				<RouterAnchor
					key={item.key}
					className={`ink-neighbour ink-neighbour-${item.key}`}
					href={item.artist.href}
					rel={item.key === "previous" ? "prev" : "next"}
				>
					<span className="ink-neighbour-label">{item.label}</span>
					<span className="ink-neighbour-name" dir="auto">
						{item.artist.name}
					</span>
				</RouterAnchor>
			))}
		</nav>
	);
}
