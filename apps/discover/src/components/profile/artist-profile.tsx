import { Link } from "@tanstack/react-router";
import type {
	DiscoverArtistDetail,
	DiscoverArtistSummary,
} from "@tattoo-drip/sdk";
import { MoreLink } from "#/components/directory/hub";
import { ArtistResults } from "#/components/directory/results";
import {
	EditorialSection,
	SectionHeading,
} from "#/components/discovery/layout";
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
import { bookingLinks, generalRequest, safeSocialUrl } from "#/lib/booking";
import { nearbyLinks, placeLine, possessive } from "#/lib/profiles";
import { paths } from "#/lib/routes";

/**
 * An artist's Discover profile (D08), for a studio's artist and for an
 * independent artist alike: hero (featured work, else portrait, else the
 * name in type), styles, where they work (their studio's profile, or
 * "Independent"), bio, portfolio, booking and related links. `colleagues`
 * are the studio's other shown artists (an optional read; undefined hides
 * the section).
 */
export function ArtistProfile({
	artist,
	colleagues,
	markets,
}: {
	artist: DiscoverArtistDetail;
	colleagues?: readonly DiscoverArtistSummary[];
	markets: readonly string[];
}) {
	const { request, site } = bookingLinks(artist, artist.slug);
	const studioPath = paths.studio(artist.studio.slug);
	const owner = artist.independent
		? possessive(artist.name)
		: possessive(artist.studio.name);
	const where = placeLine(artist.location, true);
	const lead = artist.tattoos[0];
	const bio = artist.bio?.trim();
	const online = artist.socialLinks.some((link) => safeSocialUrl(link.url));
	// Not taking requests: say so; a studio's artist still has the studio's
	// general request (the storefront offers it too), an independent none.
	const accepting = artist.acceptingInquiries;
	const shownRequest =
		request && !accepting && !artist.independent
			? generalRequest(request)
			: accepting
				? request
				: null;
	const requestLabel = accepting
		? `Request with ${artist.name}`
		: `Request a session at ${artist.studio.name}`;
	const siteLabel = artist.independent
		? "Visit their site"
		: "View on studio site";
	const actions = (
		<BookingActions
			request={shownRequest}
			requestLabel={requestLabel}
			site={site}
			siteLabel={siteLabel}
			owner={owner}
			closed={
				accepting
					? undefined
					: `${artist.name} isn't taking new requests right now.`
			}
		/>
	);
	const others = (colleagues ?? [])
		.filter((each) => each.id !== artist.id)
		.slice(0, 4);

	return (
		<>
			<ProfileHero
				breadcrumbs={
					artist.independent
						? [
								{ label: "Discover", to: paths.home() },
								{ label: "Artists", to: paths.artists() },
								{ label: artist.name },
							]
						: [
								{ label: "Discover", to: paths.home() },
								{ label: "Studios", to: paths.studios() },
								{ label: artist.studio.name, to: studioPath },
								{ label: artist.name },
							]
				}
				eyebrow={
					artist.independent ? "Independent tattoo artist" : "Tattoo artist"
				}
				title={artist.name}
				badge={
					lead &&
					artist.photo && (
						<img
							src={artist.photo.url}
							width={artist.photo.width}
							height={artist.photo.height}
							alt=""
							decoding="async"
							className="size-16 shrink-0 rounded-[2px] object-cover sm:size-20"
						/>
					)
				}
				meta={
					<>
						<p className="text-lg">
							{artist.independent ? (
								"Works independently"
							) : (
								<>
									{"At "}
									<MoreInline to={studioPath}>{artist.studio.name}</MoreInline>
								</>
							)}
							{where ? ` · ${where}` : ""}
						</p>
						{artist.styles.length > 0 && <StyleLinks styles={artist.styles} />}
					</>
				}
				media={
					<HeroMedia
						image={lead?.image ?? artist.photo}
						alt={
							lead
								? lead.image.alt?.trim() || `Tattoo by ${artist.name}`
								: `${artist.name}, tattoo artist`
						}
						name={artist.name}
					/>
				}
				actions={actions}
			/>

			{(bio || online) && (
				<EditorialSection labelledBy="artist-about-title" className="lg:py-20">
					<div className="grid gap-10 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-16">
						<div className="flex flex-col gap-6">
							<SectionHeading
								id="artist-about-title"
								eyebrow="About"
								title={bio ? `About ${artist.name}` : "Details"}
							/>
							{bio && <PlainText text={bio} />}
						</div>
						<Facts
							items={[
								{ term: "Where", value: where },
								{
									term: "Studio",
									value: artist.independent ? (
										"Independent"
									) : (
										<MoreInline to={studioPath}>
											{artist.studio.name}
										</MoreInline>
									),
								},
								{
									term: "Online",
									value: online && (
										<SocialLinks
											links={artist.socialLinks}
											owner={possessive(artist.name)}
										/>
									),
								},
							]}
						/>
					</div>
				</EditorialSection>
			)}

			{artist.tattoos.length > 0 && (
				<Portfolio
					id="artist-work-title"
					eyebrow="Portfolio"
					title={`Work by ${artist.name}`}
					intro="Their newest published photos."
					tattoos={artist.tattoos}
					caption={(tattoo) => workCaption(tattoo)}
					more={
						<MoreLink to={paths.tattoos()} search={{ artist: artist.id }}>
							{`All work by ${artist.name}`}
						</MoreLink>
					}
				/>
			)}

			{!artist.independent && others.length > 0 && (
				<EditorialSection labelledBy="artist-studio-title" className="lg:py-20">
					<div className="mb-8 flex flex-col gap-4 lg:mb-12 lg:flex-row lg:items-end lg:justify-between">
						<SectionHeading
							id="artist-studio-title"
							eyebrow="Same studio"
							title={`More artists at ${artist.studio.name}`}
						/>
						<MoreLink to={studioPath}>{`View ${artist.studio.name}`}</MoreLink>
					</div>
					<ArtistResults artists={others} works={[]} compact />
				</EditorialSection>
			)}

			{(shownRequest || site) && (
				<EditorialSection
					tone="sunk"
					labelledBy="artist-book-title"
					className="lg:py-20"
				>
					<div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
						<SectionHeading
							id="artist-book-title"
							eyebrow="Booking"
							title={
								accepting
									? `Book with ${artist.name}`
									: `Booking with ${artist.name}`
							}
							intro={
								artist.independent
									? "Send a request on their own site with your idea, placement and size. They reply to agree a date, a price and any deposit. Discover takes no bookings or payments."
									: `Send a request on ${possessive(artist.studio.name)} site with your idea, placement and size. The studio replies to agree a date, a price and any deposit. Discover takes no bookings or payments.`
							}
						/>
						{actions}
					</div>
				</EditorialSection>
			)}

			<RelatedLinks
				id="artist-related-title"
				title="Keep exploring"
				links={[
					...(artist.independent
						? []
						: [
								{
									key: "studio",
									to: studioPath,
									text: `${artist.studio.name}, the studio`,
								},
							]),
					...nearbyLinks(artist.location, markets, "artists"),
					...artist.styles.slice(0, 3).map((style) => ({
						key: `style-${style.slug}`,
						to: paths.style(style.slug),
						text: `${style.name} studios and artists`,
					})),
					{ key: "artists", to: paths.artists(), text: "Back to artists" },
				]}
			/>

			{shownRequest && (
				<StickyBooking
					name={accepting ? artist.name : artist.studio.name}
					request={shownRequest}
					label={accepting ? "Request" : "Request at studio"}
					owner={owner}
				/>
			)}
		</>
	);
}

/** An inline link to a Discover page (the studio's profile), underlined. */
function MoreInline({ to, children }: { to: string; children: string }) {
	return (
		<Link
			to={to}
			preload={false}
			className="underline decoration-accent decoration-2 underline-offset-4 hover:decoration-ink"
		>
			{children}
		</Link>
	);
}
