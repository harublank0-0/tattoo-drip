import { Fragment } from "react";
import { RouterAnchor } from "../../../components/router-anchor.tsx";
import { isAllowedHref } from "../../../links.ts";
import { inkNoirHomeCopy } from "./copy.ts";
import { type StyleEntry, stylePreviewSizes } from "./home-view.ts";
import { SectionHead } from "./parts.tsx";

const copy = inkNoirHomeCopy.styles;

/**
 * The styles index: the studio's styles as a list of large names on hairlines,
 * the quiet counterpart to the photo sections around it. A style some newest
 * photo carries links to the gallery filtered by it (`/work?style=<slug>`,
 * which /work already reads) and shows that photo small; each style names the
 * artists who list it, linking to their pages. A style only an artist lists
 * has no gallery link (the page knows no slug for it), so its name is text.
 * Nothing when nobody named a style.
 */
export function TattooStyles({ styles }: { styles: readonly StyleEntry[] }) {
	if (styles.length === 0) return null;
	return (
		<section
			id="styles"
			className="ink-section ink-styles"
			aria-labelledby="styles-title"
		>
			<div className="ink-container ink-styles-grid">
				<SectionHead id="styles-title" label={copy.eyebrow}>
					{copy.title}
				</SectionHead>
				{/* biome-ignore lint/a11y/useSemanticElements: it is a list; the role repairs WebKit's reading of list-style: none */}
				<ul
					className="ink-style-list"
					// biome-ignore lint/a11y/noRedundantRoles: redundant for the spec, needed for WebKit with list-style: none
					role="list"
				>
					{styles.map((style) => (
						<li key={style.name} className="ink-style">
							<h3 className="ink-style-name" dir="auto">
								{style.workHref && isAllowedHref(style.workHref) ? (
									<RouterAnchor
										className="ink-style-link"
										href={style.workHref}
										aria-label={copy.seeWork.replace("{style}", style.name)}
									>
										{style.name}
									</RouterAnchor>
								) : (
									style.name
								)}
							</h3>
							{style.artists.length > 0 ? (
								<p className="ink-style-artists">
									{copy.by}{" "}
									{style.artists.map((artist, index) => (
										<Fragment key={artist.href}>
											{index > 0 ? ", " : null}
											<RouterAnchor href={artist.href}>
												<bdi>{artist.name}</bdi>
											</RouterAnchor>
										</Fragment>
									))}
								</p>
							) : null}
							{style.photo ? (
								<img
									className="ink-style-preview"
									src={style.photo.src}
									srcSet={style.photo.srcSet}
									sizes={
										style.photo.srcSet
											? stylePreviewSizes(style.photo)
											: undefined
									}
									width={style.photo.width}
									height={style.photo.height}
									alt={style.photo.alt}
									loading="lazy"
									decoding="async"
								/>
							) : null}
						</li>
					))}
				</ul>
			</div>
		</section>
	);
}
