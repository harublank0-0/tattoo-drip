import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { MoreLink } from "#/components/directory/hub";
import { ArtistResults } from "#/components/directory/results";
import {
	EditorialSection,
	SectionHeading,
} from "#/components/discovery/layout";
import { BadgeImage } from "#/components/discovery/responsive-image";
import { ArtworkCredit } from "#/components/gallery/artwork-tile";
import {
	BookingActions,
	Facts,
	HeroMedia,
	PlainText,
	Portfolio,
	ProfileHero,
	RelatedLinks,
	SocialLinks,
	StickyBooking,
	StyleLinks,
	workCaption,
} from "#/components/profile/profile";
import { bookingLinks, safeSocialUrl } from "#/lib/booking";
import { crumbs } from "#/lib/breadcrumbs";
import {
	loadStudioProfile,
	nearbyLinks,
	placeLine,
	possessive,
	studioProfileQueries,
} from "#/lib/profiles";
import { paths } from "#/lib/routes";
import { pageMeta } from "#/lib/seo";
import { structuredData } from "#/lib/structured-data";
import { cn } from "#/lib/utils";

/**
 * `/studios/:studioSlug` (D08): a listed studio's Discover profile, from the
 * API's one studio read (its artists, its 12 newest photos, its public
 * links and its `bookingUrl`). Not shown by the API is the 404 page; an old
 * slug is a 301 to the current one. The visitor's country changes nothing
 * here: the location is the studio's own.
 */
export const Route = createFileRoute("/studios/$studioSlug/")({
	loader: ({ context, params }) =>
		loadStudioProfile(context, params.studioSlug),
	head: (context) => ({
		meta: context.loaderData
			? [
					...pageMeta(context.loaderData.seo),
					...structuredData(context, context.loaderData.structured),
				]
			: [],
	}),
	component: StudioProfile,
});

function StudioProfile() {
	const { discover } = Route.useRouteContext();
	const { studioSlug } = Route.useParams();
	const studio = useSuspenseQuery(
		studioProfileQueries(discover.client, studioSlug).studio,
	).data;
	const { request, site } = bookingLinks(studio);
	const owner = possessive(studio.name);
	const where = placeLine(studio.location, true);
	const cover = studio.cover ?? studio.tattoos[0]?.image ?? null;
	const intro = studio.intro?.trim();
	const online = studio.socialLinks.some((link) => safeSocialUrl(link.url));
	const actions = (
		<BookingActions
			request={request}
			requestLabel="Request a session"
			site={site}
			siteLabel="Visit studio site"
			owner={owner}
		/>
	);
	const nearby = nearbyLinks(
		studio.location,
		discover.settings.markets,
		"studios",
	);

	return (
		<>
			<ProfileHero
				breadcrumbs={crumbs.studio(studio.name)}
				eyebrow="Tattoo studio"
				title={studio.name}
				badge={
					studio.logo && (
						<span
							className={cn(
								"flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-[2px] p-2 sm:size-20",
								studio.logo.tile === "dark"
									? "bg-night"
									: "bg-paper-raised ring-1 ring-line",
							)}
						>
							<BadgeImage
								image={studio.logo}
								size={80}
								className="max-h-full max-w-full object-contain"
							/>
						</span>
					)
				}
				meta={
					<>
						{where && <p className="text-lg">{where}</p>}
						{studio.styles.length > 0 && (
							<StyleLinks styles={studio.styles} label="Styles" />
						)}
					</>
				}
				media={
					<HeroMedia
						image={cover}
						alt={
							studio.cover
								? studio.cover.alt?.trim() || `${studio.name}'s studio`
								: studio.tattoos[0]
									? `Tattoo by ${studio.tattoos[0].artist.name} at ${studio.name}`
									: ""
						}
						name={studio.name}
					/>
				}
				actions={actions}
			/>

			{(intro || online) && (
				<EditorialSection labelledBy="studio-about-title" className="lg:py-20">
					<div className="grid gap-10 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-16">
						<div className="flex flex-col gap-6">
							<SectionHeading
								id="studio-about-title"
								eyebrow="About"
								title={intro ? `About ${studio.name}` : "Studio details"}
							/>
							{intro && <PlainText text={intro} />}
						</div>
						<Facts
							items={[
								{ term: "Where", value: where },
								{
									term: "Artists",
									value:
										studio.artists.length > 0 &&
										studio.artists.map((artist) => artist.name).join(", "),
								},
								{
									term: "Online",
									value: online && (
										<SocialLinks links={studio.socialLinks} owner={owner} />
									),
								},
							]}
						/>
					</div>
				</EditorialSection>
			)}

			{studio.tattoos.length > 0 && (
				<Portfolio
					id="studio-work-title"
					eyebrow="Portfolio"
					title={`Recent work at ${studio.name}`}
					intro="The newest photos its artists have published."
					tattoos={studio.tattoos}
					caption={(tattoo) => (
						<>
							<ArtworkCredit tattoo={tattoo} studio={false} />
							{` · ${workCaption(tattoo)}`}
						</>
					)}
					more={
						<MoreLink to={paths.tattoos()} search={{ studio: studio.slug }}>
							{`All work at ${studio.name}`}
						</MoreLink>
					}
				/>
			)}

			{studio.artists.length > 0 && (
				<EditorialSection
					labelledBy="studio-artists-title"
					className="lg:py-20"
				>
					<SectionHeading
						id="studio-artists-title"
						eyebrow="Artists"
						title={`Artists at ${studio.name}`}
						className="mb-8 lg:mb-12"
					/>
					<ArtistResults artists={studio.artists} works={studio.tattoos} />
				</EditorialSection>
			)}

			{(request || site) && (
				<EditorialSection
					tone="sunk"
					labelledBy="studio-book-title"
					className="lg:py-20"
				>
					<div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
						<SectionHeading
							id="studio-book-title"
							eyebrow="Booking"
							title={`Book with ${studio.name}`}
							intro="Send a request on the studio's own site with your idea, placement and size. The studio replies to agree a date, a price and any deposit. Discover takes no bookings or payments."
						/>
						{actions}
					</div>
				</EditorialSection>
			)}

			<RelatedLinks
				id="studio-related-title"
				title="Keep exploring"
				links={[
					...nearby,
					...studio.styles.slice(0, 3).map((style) => ({
						key: `style-${style.slug}`,
						to: paths.style(style.slug),
						text: `${style.name} studios and artists`,
					})),
					{ key: "studios", to: paths.studios(), text: "Back to studios" },
				]}
			/>

			{request && (
				<StickyBooking
					name={studio.name}
					request={request}
					label="Request a session"
					owner={owner}
				/>
			)}
		</>
	);
}
