import { fill } from "../../../../intake/template.ts";
import { RouterAnchor } from "../../../components/router-anchor.tsx";
import { studioCopy } from "../../../copy.ts";
import { artistsHref, isAllowedHref, linkRel } from "../../../links.ts";
import type { ArtistView, StudioView } from "../../../view-model.ts";
import { inkNoirArtistCopy } from "./copy.ts";
import { portraitSizes } from "./sizes.ts";

const copy = inkNoirArtistCopy.hero;

/**
 * The artist's opening: the breadcrumb back to the directory, their first
 * listed style as the line above the name, the name set as large as the
 * column allows and crossing into the portrait, where they work, whether they
 * take new work, their own links, and the two ways on: booking (their own
 * request form, only while they take new work) and their work below. The
 * portrait is the page's main image: eager and high priority. Without one the
 * opening is type alone, never a stand-in photo. The page's one h1 is the
 * name. Everything here is the artist's or the studio's data.
 */
export function ArtistHero({
	artist,
	studio,
	styles,
	hasWork,
}: {
	artist: ArtistView;
	studio: StudioView;
	styles: readonly { readonly name: string }[];
	/** Whether the page shows work photos, so "Explore the work" lands somewhere. */
	hasWork: boolean;
}) {
	const links = artist.links.filter((link) => isAllowedHref(link.href));
	const primary = styles[0]?.name ?? copy.specialtyFallback;
	return (
		<header
			className={
				artist.photo
					? "ink-artist-hero"
					: "ink-artist-hero ink-artist-hero-text"
			}
		>
			<div className="ink-container ink-artist-hero-grid">
				<nav className="ink-breadcrumb" aria-label={copy.breadcrumb}>
					{/* biome-ignore lint/a11y/useSemanticElements: it is a list; the role repairs WebKit's reading of list-style: none */}
					<ol
						// biome-ignore lint/a11y/noRedundantRoles: redundant for the spec, needed for WebKit with list-style: none
						role="list"
					>
						<li>
							<RouterAnchor href={artistsHref({})}>{copy.artists}</RouterAnchor>
						</li>
						<li>
							<span aria-current="page" dir="auto">
								{artist.name}
							</span>
						</li>
					</ol>
				</nav>
				{artist.photo ? (
					<figure className="ink-artist-hero-portrait">
						<img
							src={artist.photo.src}
							srcSet={artist.photo.srcSet}
							sizes={
								artist.photo.srcSet ? portraitSizes(artist.photo) : undefined
							}
							width={artist.photo.width}
							height={artist.photo.height}
							alt={artist.photo.alt}
							loading="eager"
							decoding="async"
							fetchPriority="high"
						/>
					</figure>
				) : null}
				<div className="ink-artist-hero-text-col">
					<p className="ink-label">{primary}</p>
					<h1 className="ink-artist-hero-name" dir="auto">
						{artist.name}
					</h1>
					<dl className="ink-hero-meta ink-artist-hero-meta">
						<div>
							<dt>{copy.meta.studio}</dt>
							<dd dir="auto">
								{studio.type === "independent" ? copy.independent : studio.name}
							</dd>
						</div>
						{studio.location ? (
							<div>
								<dt>{copy.meta.based}</dt>
								<dd className="user-text" dir="auto">
									{studio.location}
								</dd>
							</div>
						) : null}
						<div>
							<dt>{copy.meta.bookings}</dt>
							<dd className={artist.accepting ? "ink-open-text" : undefined}>
								{artist.accepting
									? studioCopy.status.open
									: studioCopy.status.closed}
							</dd>
						</div>
					</dl>
					<div className="ink-hero-actions">
						{artist.accepting && isAllowedHref(artist.requestHref) ? (
							<RouterAnchor
								className="action action-primary ink-cta"
								href={artist.requestHref}
							>
								{copy.book}
							</RouterAnchor>
						) : artist.closedMessage ? (
							<p className="status status-closed user-text" dir="auto">
								{artist.closedMessage}
							</p>
						) : null}
						{hasWork ? (
							<a className="action ink-action-quiet" href="#work">
								{copy.explore}
							</a>
						) : null}
					</div>
					{links.length > 0 ? (
						<ul
							className="ink-artist-links"
							aria-label={fill(copy.links, { name: artist.name })}
						>
							{links.map((link) => (
								<li key={`${link.kind}:${link.href}`}>
									<a
										className="ink-link"
										href={link.href}
										rel={linkRel(link.href)}
									>
										{link.label}
									</a>
								</li>
							))}
						</ul>
					) : null}
				</div>
			</div>
		</header>
	);
}
