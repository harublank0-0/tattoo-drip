import { Link } from "@tanstack/react-router";
import type {
	DiscoverArtistSummary,
	DiscoverLocation,
	DiscoverStudioSummary,
	DiscoverStyle,
	DiscoverTattooSummary,
} from "@tattoo-drip/sdk";
import { ArrowRightIcon } from "lucide-react";
import type { ReactNode } from "react";
import { DiscoverySearch } from "#/components/discovery/discovery-search";
import {
	EditorialSection,
	SectionHeading,
} from "#/components/discovery/layout";
import { ProfileLink } from "#/components/discovery/profile-link";
import {
	BadgeImage,
	ResponsiveImage,
} from "#/components/discovery/responsive-image";
import { ArtworkColumns } from "#/components/gallery/artwork-tile";
import { buttonVariants } from "#/components/ui/button";
import { artistSiteNote, profileDestination } from "#/lib/destinations";
import { artistAffiliation, artistWork, tattooAlt } from "#/lib/home";
import { paths } from "#/lib/routes";
import { countryName } from "#/lib/search";
import { cn } from "#/lib/utils";

/** A note for screen readers that a link leaves Discover for the studio's own site. */
function OwnSite({
	children = "(the studio's own site)",
}: {
	children?: string;
}) {
	return <span className="sr-only">{children}</span>;
}

/** A section's heading with a link to the full page beside it from `lg`. */
function SectionTop({
	id,
	eyebrow,
	title,
	intro,
	action,
}: {
	id: string;
	eyebrow?: string;
	title: string;
	intro?: ReactNode;
	action?: ReactNode;
}) {
	return (
		<div className="mb-10 flex flex-col gap-6 lg:mb-14 lg:flex-row lg:items-end lg:justify-between">
			<SectionHeading id={id} eyebrow={eyebrow} title={title} intro={intro} />
			{action}
		</div>
	);
}

function MoreLink({ to, children }: { to: string; children: ReactNode }) {
	return (
		<Link
			to={to}
			className="group inline-flex min-h-11 shrink-0 items-center gap-2 self-start font-medium underline-offset-4 hover:underline lg:self-end"
		>
			{children}
			<ArrowRightIcon
				className="size-4 transition-transform motion-safe:group-hover:translate-x-0.5"
				aria-hidden="true"
			/>
		</Link>
	);
}

/**
 * Styles from the platform's list, each over a real recent photo tagged
 * with it, linking to the style's page (D07). Staggered tiles; the name
 * sits on a solid plate, so it reads without hovering. No counts.
 */
export function StylesSection({
	pairs,
}: {
	pairs: { style: DiscoverStyle; tattoo: DiscoverTattooSummary }[];
}) {
	return (
		<EditorialSection labelledBy="styles-title">
			<SectionTop
				id="styles-title"
				eyebrow="Browse by style"
				title="Tattoo styles"
				intro="Each one shown with recent work from artists listed here."
			/>
			<ul className="grid grid-cols-2 gap-3 pb-8 sm:gap-4 lg:grid-cols-3 lg:gap-6 lg:pb-16">
				{pairs.map(({ style, tattoo }) => (
					<li
						key={style.slug}
						className="even:translate-y-8 lg:even:translate-y-0 lg:[&:nth-child(3n+2)]:translate-y-16"
					>
						<Link to={paths.style(style.slug)} className="group relative block">
							<ResponsiveImage
								image={tattoo.image}
								alt={tattooAlt(tattoo, style)}
								ratio="4 / 5"
								sizes="(min-width: 64rem) 30vw, 50vw"
							/>
							<span className="absolute bottom-0 left-0 flex max-w-[calc(100%-0.5rem)] items-center gap-1.5 bg-paper px-2.5 py-1.5 font-display text-base font-bold text-ink sm:gap-2 sm:px-4 sm:py-3 sm:text-2xl">
								{style.name}
								<ArrowRightIcon
									className="size-4 shrink-0 transition-transform motion-safe:group-hover:translate-x-0.5 sm:size-5"
									aria-hidden="true"
								/>
							</span>
						</Link>
					</li>
				))}
			</ul>
		</EditorialSection>
	);
}

/** A studio's logo on the tile its owner chose (light or dark). */
function StudioLogo({
	logo,
}: {
	logo: NonNullable<DiscoverStudioSummary["logo"]>;
}) {
	return (
		<span
			className={cn(
				"flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-[2px] p-2 sm:size-16",
				logo.tile === "dark" ? "bg-night" : "bg-paper-raised ring-1 ring-line",
			)}
		>
			<BadgeImage
				image={logo}
				size={64}
				lazy
				className="max-h-full max-w-full object-contain"
			/>
		</span>
	);
}

/**
 * Studios in the API's own order (most recently listed first): no ranking
 * and no featured or paid placement, so the heading says "recently listed".
 * The first studio with a cover photo leads with it; each row links to the
 * studio's Discover profile, which hands off to its own site for booking.
 */
export function StudiosSection({
	studios,
}: {
	studios: readonly DiscoverStudioSummary[];
}) {
	const lead = studios.find((studio) => studio.cover);
	return (
		<EditorialSection tone="sunk" labelledBy="studios-title">
			<div className="grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
				<div className="flex flex-col gap-6">
					<SectionHeading
						id="studios-title"
						eyebrow="Studios"
						title="Recently listed studios"
						intro="Studios that chose to list on Discover, newest first. Each one takes requests on its own site."
					/>
					<MoreLink to={paths.studios()}>Explore all studios</MoreLink>
					{lead?.cover && (
						<figure className="hidden flex-col gap-2 lg:flex">
							<ResponsiveImage
								image={lead.cover}
								alt={lead.cover.alt?.trim() || `${lead.name}'s studio`}
								ratio="4 / 3"
								sizes="40vw"
							/>
							<figcaption className="text-sm text-ink-muted">
								{lead.name}
							</figcaption>
						</figure>
					)}
				</div>
				<ul className="self-start border-t border-ink">
					{studios.map((studio) => (
						<li key={studio.id} className="border-b border-line">
							<ProfileLink
								destination={profileDestination(studio)}
								className="group flex min-h-24 items-center gap-4 py-5 sm:gap-6"
							>
								{studio.logo && <StudioLogo logo={studio.logo} />}
								<span className="flex min-w-0 flex-1 flex-col gap-1">
									<span className="font-display text-display-md font-bold break-words">
										{studio.name}
									</span>
									<span className="text-sm text-ink-muted">
										{[
											studio.location?.name,
											...studio.styles.slice(0, 3).map((style) => style.name),
										]
											.filter(Boolean)
											.join(" · ")}
									</span>
								</span>
								<ArrowRightIcon
									className="size-5 shrink-0 transition-transform motion-safe:group-hover:translate-x-0.5"
									aria-hidden="true"
								/>
								{profileDestination(studio).external && <OwnSite />}
							</ProfileLink>
						</li>
					))}
				</ul>
			</div>
		</EditorialSection>
	);
}

/**
 * Artists, studio-affiliated and independent: work first (their newest
 * recent photo, else their portrait), then name, styles and where they
 * work. Each links to the artist's Discover profile.
 */
export function ArtistsSection({
	artists,
	tattoos,
}: {
	artists: readonly DiscoverArtistSummary[];
	tattoos: readonly DiscoverTattooSummary[];
}) {
	return (
		<EditorialSection labelledBy="artists-title">
			<SectionTop
				id="artists-title"
				eyebrow="Artists"
				title="Recently added artists"
				intro="Artists at listed studios and independent artists, newest first."
				action={<MoreLink to={paths.artists()}>Find artists</MoreLink>}
			/>
			<ul className="grid grid-cols-2 gap-x-3 gap-y-10 sm:gap-x-4 lg:grid-cols-4 lg:gap-x-6">
				{artists.map((artist) => {
					const work = artistWork(artist, tattoos);
					const image = work?.image ?? artist.photo;
					return (
						<li key={artist.id} className="lg:even:pt-12">
							<ProfileLink
								destination={profileDestination(artist)}
								className="group flex flex-col gap-3"
							>
								{image ? (
									<ResponsiveImage
										image={image}
										alt={
											work ? tattooAlt(work) : `${artist.name}, tattoo artist`
										}
										ratio="3 / 4"
										sizes="(min-width: 64rem) 22vw, 50vw"
									/>
								) : (
									<span
										aria-hidden="true"
										className="night flex aspect-[3/4] items-end p-4 font-display text-display-lg font-bold"
									>
										{artist.name.trim().charAt(0).toUpperCase()}
									</span>
								)}
								<span className="flex flex-col gap-1">
									<span className="flex items-start justify-between gap-2 font-display text-xl font-bold sm:text-2xl">
										<span className="min-w-0 break-words">{artist.name}</span>
										<ArrowRightIcon
											className="mt-1 size-4 shrink-0"
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
								{profileDestination(artist).external && (
									<OwnSite>{`(${artistSiteNote(artist)})`}</OwnSite>
								)}
							</ProfileLink>
						</li>
					);
				})}
			</ul>
		</EditorialSection>
	);
}

/**
 * Recent work in columns at each photo's true proportions (fixed frames,
 * lazy below the fold), credited "artist · studio". Each photo links to its
 * artwork page (D09), the artist's name to their profile; "Explore artwork"
 * opens the gallery.
 */
export function InspirationSection({
	tattoos,
}: {
	tattoos: readonly DiscoverTattooSummary[];
}) {
	return (
		<EditorialSection tone="night" labelledBy="inspiration-title">
			<SectionTop
				id="inspiration-title"
				eyebrow="Inspiration"
				title="Fresh from the studios"
				intro="The newest work artists have published."
				action={<MoreLink to={paths.tattoos()}>Explore artwork</MoreLink>}
			/>
			<ArtworkColumns tattoos={tattoos} />
		</EditorialSection>
	);
}

/**
 * The places listed businesses are in (the API's order: country, then
 * name), grouped by country, each linking to its city page (D07; the
 * country's name to its location page). No
 * counts: a short list should read as a list, not as a score.
 */
export function LocationsSection({
	locations,
}: {
	locations: readonly DiscoverLocation[];
}) {
	const countries = new Map<string, DiscoverLocation[]>();
	for (const location of locations) {
		const group = countries.get(location.country) ?? [];
		group.push(location);
		countries.set(location.country, group);
	}
	return (
		<EditorialSection labelledBy="locations-title">
			<div className="grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
				<SectionHeading
					id="locations-title"
					eyebrow="Places"
					title="Find studios near you"
					intro="Cities where studios and artists are listed."
				/>
				<div className="flex flex-col gap-10">
					{[...countries].map(([country, places]) => (
						<div key={country} className="flex flex-col gap-4">
							<h3 className="eyebrow text-ink-muted">
								<Link
									to={paths.location(country)}
									className="inline-flex min-h-11 items-center underline-offset-4 hover:text-ink hover:underline"
								>
									{countryName(country)}
								</Link>
							</h3>
							<ul className="flex flex-wrap gap-x-8 gap-y-1 border-t border-ink pt-4">
								{places.map((place) => (
									<li key={place.slug}>
										<Link
											to={paths.city(place.country, place.slug)}
											className="inline-flex min-h-11 items-baseline gap-2 font-display text-display-md font-bold underline-offset-[0.2em] decoration-accent decoration-2 hover:underline"
										>
											{place.name}
											{place.region && (
												<span className="font-sans text-sm font-normal text-ink-muted">
													{place.region}
												</span>
											)}
										</Link>
									</li>
								))}
							</ul>
						</div>
					))}
				</div>
			</div>
		</EditorialSection>
	);
}

const STEPS = [
	{
		title: "Send a request on the studio's site",
		body: "Describe your idea, the placement and size, and add reference pictures. Discover takes no bookings or payments itself.",
	},
	{
		title: "The studio replies",
		body: "They answer on WhatsApp or Viber, agree a price with you, and ask for a deposit when their policy needs one.",
	},
	{
		title: "Your session",
		body: "You meet your artist at the studio on the date you agreed. Their site has their policies and aftercare notes when they publish them.",
	},
];

/** How booking works: accurate and static, on the studio's own site. */
export function BookingSteps() {
	return (
		<EditorialSection tone="sunk" labelledBy="booking-title">
			<SectionTop
				id="booking-title"
				eyebrow="How booking works"
				title="You book with the studio, directly."
			/>
			<ol className="grid gap-x-10 gap-y-8 border-t border-ink pt-8 lg:grid-cols-3">
				{STEPS.map((step, index) => (
					<li key={step.title} className="flex gap-5 lg:flex-col lg:gap-4">
						<span
							aria-hidden="true"
							className="font-display text-display-lg leading-none font-bold text-accent"
						>
							{index + 1}
						</span>
						<div className="flex flex-col gap-2">
							<h3 className="font-display text-2xl font-bold">{step.title}</h3>
							<p className="max-w-md text-ink-muted">{step.body}</p>
						</div>
					</li>
				))}
			</ol>
		</EditorialSection>
	);
}

/** The one Studio OS band: marketing is a band on the homepage, not the page. */
export function StudioOsBand() {
	return (
		<EditorialSection tone="night" labelledBy="studio-os-title">
			<div className="flex flex-col items-start gap-8 lg:flex-row lg:items-end lg:justify-between">
				<div className="flex max-w-3xl flex-col gap-4">
					<p className="eyebrow text-accent-bright">Studio OS</p>
					<h2
						id="studio-os-title"
						className="font-display text-display-lg font-bold"
					>
						Run your studio on Studio OS. Get found here.
					</h2>
					<p className="max-w-2xl text-lg text-night-muted">
						Requests, quotes, deposits, sessions and your own studio website,
						for studios and independent artists.
					</p>
				</div>
				<Link
					to={paths.forStudios()}
					className={buttonVariants({ variant: "accent", size: "lg" })}
				>
					See Studio OS
				</Link>
			</div>
		</EditorialSection>
	);
}

/** The closing call to action: back to discovery, with a small link for professionals. */
export function FinalCta() {
	return (
		<EditorialSection labelledBy="final-title">
			<div className="grid gap-10 lg:grid-cols-[minmax(0,6fr)_minmax(0,6fr)] lg:items-end lg:gap-16">
				<div className="flex flex-col gap-4">
					<h2
						id="final-title"
						className="font-display text-display-lg font-bold"
					>
						Know the studio's name?
					</h2>
					<p className="max-w-xl text-lg text-ink-muted">
						Search for it, or browse the studios and artists listed so far.
					</p>
				</div>
				<div className="flex flex-col gap-6">
					<DiscoverySearch
						action={paths.studios()}
						label="Search studios by name"
						placeholder="Studio name"
					/>
					<div className="flex flex-wrap items-center gap-x-6 gap-y-2">
						<MoreLink to={paths.studios()}>Explore studios</MoreLink>
						<MoreLink to={paths.artists()}>Find artists</MoreLink>
						<Link
							to={paths.forStudios()}
							className="inline-flex min-h-11 items-center text-sm text-ink-muted underline-offset-4 hover:text-ink hover:underline"
						>
							Tattoo professional? Studio OS
						</Link>
					</div>
				</div>
			</div>
		</EditorialSection>
	);
}
