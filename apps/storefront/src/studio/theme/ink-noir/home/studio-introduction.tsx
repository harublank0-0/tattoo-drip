import { RouterAnchor } from "../../../components/router-anchor.tsx";
import type { StudioView } from "../../../view-model.ts";
import { inkNoirHomeCopy } from "./copy.ts";
import { type HomePhoto, introPhotoSizes } from "./home-view.ts";

const copy = inkNoirHomeCopy.intro;

/**
 * The introduction: the studio's own words beside a photograph. The heading
 * is the theme's line; the paragraph is the studio's intro, and the facts are
 * only what its data says (where it is, how many artists). The link
 * goes on down the page, to the visit when that section is shown, else to the
 * artists: the platform has no separate studio page.
 */
export function StudioIntroduction({
	studio,
	photo,
	artistCount,
	next,
}: {
	studio: StudioView;
	photo: HomePhoto | null;
	/** How many artists the page shows; 0 when the roster is hidden. */
	artistCount: number;
	/** Where "Plan your visit" or "Meet the artists" leads, or null. */
	next: { readonly href: string; readonly label: string } | null;
}) {
	return (
		<section
			id="studio"
			className={
				photo ? "ink-section ink-intro" : "ink-section ink-intro ink-intro-text"
			}
			aria-labelledby="studio-title"
		>
			<div className="ink-container ink-intro-grid">
				<div className="ink-intro-copy">
					<p className="ink-label">{copy.eyebrow[studio.type]}</p>
					<h2 id="studio-title" className="ink-title ink-intro-title">
						{copy.title}
					</h2>
					{studio.intro ? (
						<p className="ink-intro-text-body user-text" dir="auto">
							{studio.intro}
						</p>
					) : null}
					{studio.location || artistCount > 1 ? (
						<dl className="ink-facts">
							{studio.location ? (
								<div>
									<dt>{copy.facts.based}</dt>
									<dd className="user-text" dir="auto">
										{studio.location}
									</dd>
								</div>
							) : null}
							{artistCount > 1 ? (
								<div>
									<dt>{copy.facts.artists}</dt>
									<dd>{artistCount}</dd>
								</div>
							) : null}
						</dl>
					) : null}
					{next ? (
						<p className="ink-intro-next">
							<RouterAnchor className="ink-link" href={next.href}>
								{next.label}
							</RouterAnchor>
						</p>
					) : null}
				</div>
				{photo ? (
					<figure className="ink-intro-photo">
						<img
							src={photo.src}
							srcSet={photo.srcSet}
							sizes={photo.srcSet ? introPhotoSizes(photo) : undefined}
							width={photo.width}
							height={photo.height}
							alt={photo.alt}
							loading="lazy"
							decoding="async"
						/>
					</figure>
				) : null}
			</div>
		</section>
	);
}
