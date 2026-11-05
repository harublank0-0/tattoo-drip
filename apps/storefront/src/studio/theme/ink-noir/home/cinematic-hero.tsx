import { RouterAnchor } from "../../../components/router-anchor.tsx";
import { BookingCta } from "../../../components/storefront.tsx";
import { studioCopy } from "../../../copy.ts";
import { workHref } from "../../../links.ts";
import type { StudioPageData } from "../../../loaders.ts";
import { OpenNow } from "../../../open-now.tsx";
import { inkNoirHomeCopy } from "./copy.ts";
import { type HeroImage, heroSizes } from "./home-view.ts";
import { Lines } from "./parts.tsx";

const copy = inkNoirHomeCopy.hero;

/**
 * The first screen: the studio's photograph on the right (the whole screen on
 * a phone), the headline set large over its edge on the left, the way to book
 * and to the work, and a few facts from the studio's data along the foot
 * (where it is, today's hours, that it takes new work; a closed studio says so
 * once, beside the buttons).
 * The h1 is the studio's name followed by the headline, so the page's one
 * heading names the studio. Without a photo the screen is type alone.
 *
 * The photo is the page's first image: eager, high priority (React preloads
 * it with its srcset), never lazy. Width and height are set, and CSS crops it
 * into its box, so nothing shifts while it loads.
 */
export function CinematicHero({
	data,
	image,
	scrollTo,
}: {
	data: StudioPageData;
	image: HeroImage | null;
	/** The introduction's fragment for the scroll cue, or null when there is none. */
	scrollTo: string | null;
}) {
	const { studio, openNow } = data;
	const hours = openNow?.week.some((day) => day !== null) ? openNow : null;
	return (
		<section
			className={image ? "ink-hero ink-hero-photo" : "ink-hero"}
			aria-labelledby="hero-title"
		>
			{image ? (
				<div className="ink-hero-media">
					<img
						src={image.src}
						srcSet={image.srcSet}
						sizes={image.srcSet ? heroSizes(image) : undefined}
						width={image.width}
						height={image.height}
						alt={image.alt}
						loading="eager"
						decoding="async"
						fetchPriority="high"
					/>
				</div>
			) : null}
			<div className="ink-hero-inner">
				<h1 id="hero-title" className="ink-hero-title">
					<span className="ink-hero-name" dir="auto">
						{studio.name}
					</span>{" "}
					<span className="ink-hero-line">
						<Lines lines={copy.lines} />
					</span>
				</h1>
				<p className="ink-hero-support">{copy.support[studio.type]}</p>
				<div className="ink-hero-actions">
					{data.requestLink ? (
						<BookingCta link={data.requestLink} className="ink-cta" />
					) : (
						<p className="status status-closed">{studioCopy.notTaking}</p>
					)}
					<RouterAnchor className="action ink-action-quiet" href={workHref({})}>
						{copy.explore}
					</RouterAnchor>
				</div>
				{studio.location || hours || studio.accepting ? (
					<dl className="ink-hero-meta" aria-label={copy.meta.label}>
						{studio.location ? (
							<div>
								<dt>{copy.meta.based}</dt>
								<dd className="user-text" dir="auto">
									{studio.location}
								</dd>
							</div>
						) : null}
						{hours ? (
							<div>
								<dt>{copy.meta.today}</dt>
								<dd>
									<OpenNow view={hours} />
								</dd>
							</div>
						) : null}
						{studio.accepting ? (
							<div>
								<dt>{copy.meta.bookings}</dt>
								<dd>{studioCopy.status.open}</dd>
							</div>
						) : null}
					</dl>
				) : null}
			</div>
			{scrollTo ? (
				<a className="ink-hero-scroll" href={scrollTo}>
					<span>
						{copy.scroll}
						<span className="sr-only">{copy.scrollRest}</span>
					</span>
				</a>
			) : null}
		</section>
	);
}
