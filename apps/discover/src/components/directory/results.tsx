import type {
	DiscoverArtistSummary,
	DiscoverStudioSummary,
	DiscoverTattooSummary,
} from "@tattoo-drip/sdk";
import { ArrowUpRightIcon } from "lucide-react";
import { ResponsiveImage } from "#/components/discovery/responsive-image";
import { artistSiteNote, profileDestination } from "#/lib/destinations";
import { artistWorks, studioWorks } from "#/lib/directory";
import { artistAffiliation, tattooAlt } from "#/lib/home";
import { cn } from "#/lib/utils";

/** For screen readers: where a link goes while Discover has no profiles of its own (D08). */
function Leaves({ external, what }: { external: boolean; what: string }) {
	return external ? <span className="sr-only">{`(${what})`}</span> : null;
}

/** The first letter of a name, for a typographic tile. */
function initial(name: string): string {
	return name.trim().charAt(0).toUpperCase() || "·";
}

/** A studio's logo on the tile its owner chose (light or dark). */
function Logo({
	logo,
	className,
}: {
	logo: NonNullable<DiscoverStudioSummary["logo"]>;
	className?: string;
}) {
	return (
		<span
			className={cn(
				"flex shrink-0 items-center justify-center overflow-hidden rounded-[2px] p-2",
				logo.tile === "dark" ? "bg-night" : "bg-paper-raised ring-1 ring-line",
				className,
			)}
		>
			<img
				src={logo.url}
				width={logo.width}
				height={logo.height}
				alt=""
				loading="lazy"
				decoding="async"
				className="max-h-full max-w-full object-contain"
			/>
		</span>
	);
}

/**
 * A studio's picture: a strip of its recent work when the page's recent
 * photos hold three, else its cover, else one photo, else its logo, else
 * its name set in type. Never a stock image.
 */
function StudioMedia({
	studio,
	works,
}: {
	studio: DiscoverStudioSummary;
	works: DiscoverTattooSummary[];
}) {
	if (works.length >= 3)
		return (
			<span className="grid grid-cols-3 gap-1">
				{works.map((work) => (
					<ResponsiveImage
						key={work.id}
						image={work.image}
						alt={tattooAlt(work)}
						ratio="4 / 5"
						sizes="(min-width: 64rem) 13vw, 33vw"
					/>
				))}
			</span>
		);
	const image = studio.cover ?? works[0]?.image;
	if (image)
		return (
			<ResponsiveImage
				image={image}
				alt={
					studio.cover
						? studio.cover.alt?.trim() || `${studio.name}'s studio`
						: works[0]
							? tattooAlt(works[0])
							: ""
				}
				ratio="3 / 2"
				sizes="(min-width: 64rem) 40vw, 100vw"
			/>
		);
	if (studio.logo)
		return (
			<span className="flex aspect-[3/2] items-center justify-center bg-paper-sunk">
				<Logo logo={studio.logo} className="size-24 sm:size-28" />
			</span>
		);
	return (
		<span
			aria-hidden="true"
			className="night flex aspect-[3/2] items-end p-5 font-display text-display-lg leading-none font-bold"
		>
			{initial(studio.name)}
		</span>
	);
}

/**
 * Studio results: editorial rows, picture first (recent work, cover, logo
 * or type), then the name, city, styles and the link to the studio. No
 * description, artist count or figures: the API's list has none.
 */
export function StudioResults({
	studios,
	works,
	headingLevel = 3,
}: {
	studios: readonly DiscoverStudioSummary[];
	/** Recent photos of the same filters, for each studio's strip. */
	works: readonly DiscoverTattooSummary[];
	headingLevel?: 2 | 3;
}) {
	const Heading = `h${headingLevel}` as const;
	return (
		<ul className="border-t border-ink">
			{studios.map((studio) => {
				const destination = profileDestination(studio);
				const own = studioWorks(studio, works);
				const hasPicture = own.length > 0 || Boolean(studio.cover);
				return (
					<li key={studio.id} className="border-b border-line">
						<a
							href={destination.href}
							className="group grid gap-4 py-6 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:items-center sm:gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-12"
						>
							<StudioMedia studio={studio} works={own} />
							<span className="flex min-w-0 flex-col gap-2">
								<span className="flex items-center gap-3">
									{hasPicture && studio.logo && (
										<Logo logo={studio.logo} className="size-12" />
									)}
									<Heading className="min-w-0 font-display text-display-md font-bold break-words">
										{studio.name}
									</Heading>
								</span>
								{studio.location && (
									<span className="text-ink">
										{studio.location.region
											? `${studio.location.name}, ${studio.location.region}`
											: studio.location.name}
									</span>
								)}
								{studio.styles.length > 0 && (
									<span className="text-sm text-ink-muted">
										{studio.styles
											.slice(0, 4)
											.map((style) => style.name)
											.join(" · ")}
									</span>
								)}
								<span className="mt-2 inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-medium underline-offset-4 group-hover:underline lg:min-h-0">
									{destination.external ? "Visit studio site" : "View studio"}
									<ArrowUpRightIcon className="size-4" aria-hidden="true" />
								</span>
							</span>
							<Leaves
								external={destination.external}
								what="the studio's own site"
							/>
						</a>
					</li>
				);
			})}
		</ul>
	);
}

/**
 * An artist's mini portfolio: their recent work (one large photo and up to
 * two more) when the page's recent photos hold it, else their portrait,
 * else their initial. Fixed frames: no layout shift.
 */
function ArtistMedia({
	artist,
	works,
}: {
	artist: DiscoverArtistSummary;
	works: DiscoverTattooSummary[];
}) {
	const [lead, second, third] = works;
	const sizes = "(min-width: 80rem) 22vw, (min-width: 64rem) 30vw, 50vw";
	if (lead && second)
		return (
			<span className="flex flex-col gap-1">
				<ResponsiveImage
					image={lead.image}
					alt={tattooAlt(lead)}
					ratio="4 / 3"
					sizes={sizes}
				/>
				{third ? (
					<span className="grid grid-cols-2 gap-1">
						{[second, third].map((work) => (
							<ResponsiveImage
								key={work.id}
								image={work.image}
								alt={tattooAlt(work)}
								ratio="1 / 1"
								sizes="(min-width: 64rem) 12vw, 25vw"
							/>
						))}
					</span>
				) : (
					<ResponsiveImage
						image={second.image}
						alt={tattooAlt(second)}
						ratio="2 / 1"
						sizes={sizes}
					/>
				)}
			</span>
		);
	const image = lead?.image ?? artist.photo;
	if (image)
		return (
			<ResponsiveImage
				image={image}
				alt={lead ? tattooAlt(lead) : `${artist.name}, tattoo artist`}
				ratio="4 / 5"
				sizes={sizes}
			/>
		);
	return (
		<span
			aria-hidden="true"
			className="night flex aspect-[4/5] items-end p-4 font-display text-display-lg leading-none font-bold"
		>
			{initial(artist.name)}
		</span>
	);
}

/**
 * Artist results: work first, then the name, where they work ("at Studio ·
 * City" or "Independent · City") and their styles; each links to the
 * artist's page (`profileDestination`).
 */
export function ArtistResults({
	artists,
	works,
	headingLevel = 3,
}: {
	artists: readonly DiscoverArtistSummary[];
	works: readonly DiscoverTattooSummary[];
	headingLevel?: 2 | 3;
}) {
	const Heading = `h${headingLevel}` as const;
	return (
		<ul className="grid grid-cols-1 gap-x-4 gap-y-10 min-[26rem]:grid-cols-2 lg:grid-cols-3 lg:gap-x-6 xl:grid-cols-4">
			{artists.map((artist) => {
				const destination = profileDestination(artist);
				return (
					<li key={artist.id}>
						<a href={destination.href} className="group flex flex-col gap-3">
							<ArtistMedia artist={artist} works={artistWorks(artist, works)} />
							<span className="flex flex-col gap-1">
								<span className="flex items-start justify-between gap-2">
									<Heading className="min-w-0 font-display text-xl font-bold break-words sm:text-2xl">
										{artist.name}
									</Heading>
									<ArrowUpRightIcon
										className="mt-1.5 size-4 shrink-0"
										aria-hidden="true"
									/>
								</span>
								<span className="text-sm text-ink">
									{artistAffiliation(artist)}
								</span>
								{artist.styles.length > 0 && (
									<span className="text-sm text-ink-muted">
										{artist.styles
											.slice(0, 3)
											.map((style) => style.name)
											.join(", ")}
									</span>
								)}
							</span>
							<Leaves
								external={destination.external}
								what={artistSiteNote(artist)}
							/>
						</a>
					</li>
				);
			})}
		</ul>
	);
}
