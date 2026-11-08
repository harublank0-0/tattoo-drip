import type {
	DiscoverArtistSummary,
	DiscoverStudioSummary,
	DiscoverTattooSummary,
} from "@tattoo-drip/sdk";
import { ArrowRightIcon, ArrowUpRightIcon } from "lucide-react";
import { ProfileLink } from "#/components/discovery/profile-link";
import {
	BadgeImage,
	ResponsiveImage,
} from "#/components/discovery/responsive-image";
import { artistSiteNote, profileDestination } from "#/lib/destinations";
import { artistWorks, studioWorks } from "#/lib/directory";
import { artistAffiliation, tattooAlt } from "#/lib/home";
import { cn } from "#/lib/utils";

/** For screen readers: where a link goes when it leaves Discover (only while `PROFILE_PAGES` is off). */
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
	size,
	className,
}: {
	logo: NonNullable<DiscoverStudioSummary["logo"]>;
	/** Its tile's largest size in CSS px, for the copy it loads. */
	size: number;
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
			<BadgeImage
				image={logo}
				size={size}
				lazy
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
	lead = false,
}: {
	studio: DiscoverStudioSummary;
	works: DiscoverTattooSummary[];
	/** The list's first row (D10): its first image loads at once with high priority (the page's likely LCP); the rest stay lazy, so nothing competes with it. */
	lead?: boolean;
}) {
	if (works.length >= 3)
		return (
			<span className="grid grid-cols-3 gap-1">
				{works.map((work, index) => (
					<ResponsiveImage
						key={work.id}
						image={work.image}
						alt={tattooAlt(work)}
						ratio="4 / 5"
						sizes="(min-width: 64rem) 13vw, (min-width: 40rem) 14vw, 33vw"
						priority={lead && index === 0}
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
				sizes="(min-width: 40rem) 40vw, 100vw"
				priority={lead}
			/>
		);
	if (studio.logo)
		return (
			<span className="flex aspect-[3/2] items-center justify-center bg-paper-sunk">
				<Logo logo={studio.logo} size={112} className="size-24 sm:size-28" />
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
 * description, artist count or figures: the API's list has none. Each
 * links to the studio's Discover profile (`profileDestination`).
 */
export function StudioResults({
	studios,
	works,
	headingLevel = 3,
	lead = false,
}: {
	studios: readonly DiscoverStudioSummary[];
	/** Recent photos of the same filters, for each studio's strip. */
	works: readonly DiscoverTattooSummary[];
	headingLevel?: 2 | 3;
	/** The page's main list (a directory): the first row's picture loads first. */
	lead?: boolean;
}) {
	const Heading = `h${headingLevel}` as const;
	return (
		<ul className="border-t border-ink">
			{studios.map((studio, index) => {
				const destination = profileDestination(studio);
				const own = studioWorks(studio, works);
				const hasPicture = own.length > 0 || Boolean(studio.cover);
				return (
					<li key={studio.id} className="border-b border-line">
						<ProfileLink
							destination={destination}
							className="group grid gap-4 py-6 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:items-center sm:gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-12"
						>
							<StudioMedia
								studio={studio}
								works={own}
								lead={lead && index === 0}
							/>
							<span className="flex min-w-0 flex-col gap-2">
								<span className="flex items-center gap-3">
									{hasPicture && studio.logo && (
										<Logo logo={studio.logo} size={48} className="size-12" />
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
									{destination.external ? (
										<ArrowUpRightIcon className="size-4" aria-hidden="true" />
									) : (
										<ArrowRightIcon className="size-4" aria-hidden="true" />
									)}
								</span>
							</span>
							<Leaves
								external={destination.external}
								what="the studio's own site"
							/>
						</ProfileLink>
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
	compact,
	first = false,
}: {
	artist: DiscoverArtistSummary;
	works: DiscoverTattooSummary[];
	compact: boolean;
	/** The list's first card (D10): its lead image loads at once with high priority; the smaller ones stay lazy. */
	first?: boolean;
}) {
	const [lead, second, third] = works;
	// Two columns to lg (one below 26rem: there 50vw caps the copy at about
	// 1.7x density, the 640 px copy, instead of the 1280 px one: measured in
	// D10, the sharper copy doubled the page's photo bytes and its LCP), three,
	// then four from xl; compact: two, then four from lg.
	const sizes = compact
		? "(min-width: 64rem) 22vw, 50vw"
		: "(min-width: 80rem) 22vw, (min-width: 64rem) 30vw, 50vw";
	const small = compact
		? "(min-width: 64rem) 11vw, 25vw"
		: "(min-width: 64rem) 12vw, 25vw";
	if (lead && second)
		return (
			<span className="flex flex-col gap-1">
				<ResponsiveImage
					image={lead.image}
					alt={tattooAlt(lead)}
					ratio="4 / 3"
					sizes={sizes}
					priority={first}
				/>
				{third ? (
					<span className="grid grid-cols-2 gap-1">
						{[second, third].map((work) => (
							<ResponsiveImage
								key={work.id}
								image={work.image}
								alt={tattooAlt(work)}
								ratio="1 / 1"
								sizes={small}
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
				priority={first}
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
	compact = false,
	lead = false,
}: {
	artists: readonly DiscoverArtistSummary[];
	works: readonly DiscoverTattooSummary[];
	headingLevel?: 2 | 3;
	/** Two columns from the smallest phone (a profile's "more artists"). */
	compact?: boolean;
	/** The page's main list (a directory): the first card's work loads first. */
	lead?: boolean;
}) {
	const Heading = `h${headingLevel}` as const;
	return (
		<ul
			className={cn(
				"grid gap-x-4 gap-y-10 lg:gap-x-6",
				compact
					? "grid-cols-2 gap-x-3 gap-y-8 lg:grid-cols-4"
					: "grid-cols-1 min-[26rem]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4",
			)}
		>
			{artists.map((artist, index) => {
				const destination = profileDestination(artist);
				return (
					<li key={artist.id}>
						<ProfileLink
							destination={destination}
							className="group flex flex-col gap-3"
						>
							<ArtistMedia
								artist={artist}
								works={artistWorks(artist, works)}
								compact={compact}
								first={lead && index === 0}
							/>
							<span className="flex flex-col gap-1">
								<span className="flex items-start justify-between gap-2">
									<Heading className="min-w-0 font-display text-xl font-bold break-words sm:text-2xl">
										{artist.name}
									</Heading>
									{destination.external && (
										<ArrowUpRightIcon
											className="mt-1.5 size-4 shrink-0"
											aria-hidden="true"
										/>
									)}
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
						</ProfileLink>
					</li>
				);
			})}
		</ul>
	);
}
