import { Link } from "@tanstack/react-router";
import type { DiscoverTattooSummary } from "@tattoo-drip/sdk";
import { ArrowRightIcon } from "lucide-react";
import { DiscoverySearch } from "#/components/discovery/discovery-search";
import { PageContainer } from "#/components/discovery/layout";
import { ResponsiveImage } from "#/components/discovery/responsive-image";
import { Button, buttonVariants } from "#/components/ui/button";
import { tattooDestination } from "#/lib/destinations";
import { tattooAlt, tattooCredit } from "#/lib/home";
import { PRIMARY_NAV, paths } from "#/lib/routes";

/**
 * The homepage's discovery hero (D06): the headline, the studio search (the
 * one text search the API answers: studio names), the two explore actions
 * and a quiet link for professionals. With at least four recent photos an
 * asymmetric collage of the newest work sits beside it; with fewer the hero
 * is typographic, with the explore links set large (no stock images).
 */
export function HomeHero({
	photos,
	unavailable,
	onRetry,
}: {
	/** The newest photos for the collage, or none for the typographic hero. */
	photos: DiscoverTattooSummary[];
	/** Every read failed: a quiet note with a retry, under the search. */
	unavailable: boolean;
	onRetry: () => void;
}) {
	return (
		<section aria-labelledby="home-title" className="border-b border-line">
			<PageContainer className="grid gap-12 py-12 sm:py-16 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-16 lg:py-24">
				<div className="flex flex-col gap-8 lg:justify-center">
					<div className="flex flex-col gap-5 motion-safe:animate-fade-up">
						<p className="eyebrow text-accent">Tattoo Drip Discover</p>
						<h1
							id="home-title"
							className="max-w-[14ch] font-display text-display-xl font-bold"
						>
							Find your next tattoo artist.
						</h1>
						<p className="max-w-xl text-lg text-ink-muted">
							Real studios and independent artists, with the work they have
							published. When you find the one, you book on their own site.
						</p>
					</div>
					<DiscoverySearch
						action={paths.studios()}
						label="Search studios by name"
						placeholder="Studio name"
						size="lg"
						className="max-w-2xl"
					/>
					{unavailable && (
						<div
							role="alert"
							className="flex max-w-2xl flex-wrap items-center gap-x-4 gap-y-2 border-l-2 border-accent pl-4 text-sm text-ink-muted"
						>
							<p>Studios, artists and work couldn't load just now.</p>
							<Button variant="outline" size="sm" onClick={onRetry}>
								Try again
							</Button>
						</div>
					)}
					<div className="flex flex-wrap items-center gap-3">
						<Link
							to={paths.studios()}
							className={buttonVariants({ variant: "primary", size: "lg" })}
						>
							Explore studios
						</Link>
						<Link
							to={paths.artists()}
							className={buttonVariants({ variant: "outline", size: "lg" })}
						>
							Find artists
						</Link>
					</div>
					<Link
						to={paths.forStudios()}
						className="inline-flex min-h-11 items-center gap-2 self-start text-sm text-ink-muted underline-offset-4 hover:text-ink hover:underline"
					>
						For tattoo professionals
						<ArrowRightIcon className="size-4" aria-hidden="true" />
					</Link>
				</div>
				{photos.length > 0 ? (
					<Collage photos={photos} />
				) : (
					<nav aria-label="Explore" className="self-end">
						<ul className="border-t border-ink">
							{PRIMARY_NAV.map((item) => (
								<li key={item.to} className="border-b border-line">
									<Link
										to={item.to}
										className="group flex min-h-20 items-center justify-between gap-6 py-4 font-display text-display-md font-bold"
									>
										{item.label}
										<ArrowRightIcon
											className="size-6 shrink-0 transition-transform motion-safe:group-hover:translate-x-1"
											aria-hidden="true"
										/>
									</Link>
								</li>
							))}
						</ul>
					</nav>
				)}
			</PageContainer>
		</section>
	);
}

/**
 * Four photos in two offset columns: a tall one leading, the others in
 * other proportions. Fixed frames (no layout shift); the first loads at
 * once with high priority, the rest lazily. Each opens its artwork page (D09).
 */
function Collage({ photos }: { photos: DiscoverTattooSummary[] }) {
	const [first, second, third, fourth] = photos;
	const sizes = "(min-width: 64rem) 22vw, 50vw";
	const frame = (
		tattoo: DiscoverTattooSummary | undefined,
		ratio: string,
		priority = false,
	) =>
		tattoo ? (
			<figure className="flex flex-col gap-2">
				<Link
					to={tattooDestination(tattoo)}
					preload={false}
					className="group block"
				>
					<ResponsiveImage
						image={tattoo.image}
						alt={tattooAlt(tattoo)}
						ratio={ratio}
						sizes={sizes}
						priority={priority}
					/>
				</Link>
				<figcaption className="truncate text-xs text-ink-muted">
					{tattooCredit(tattoo)}
				</figcaption>
			</figure>
		) : null;
	return (
		<div className="grid grid-cols-2 items-start gap-3 sm:gap-4">
			<div className="flex flex-col gap-3 sm:gap-4">
				{frame(first, "4 / 5", true)}
				{frame(third, "1 / 1")}
			</div>
			<div className="flex flex-col gap-3 pt-12 sm:gap-4 sm:pt-20">
				{frame(second, "3 / 4")}
				{frame(fourth, "4 / 5")}
			</div>
		</div>
	);
}
