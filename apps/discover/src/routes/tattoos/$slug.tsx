import { useQueries, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { discoverQueries } from "@tattoo-drip/react";
import { HubSection, MoreLink } from "#/components/directory/hub";
import { Breadcrumbs, PageContainer } from "#/components/discovery/layout";
import {
	ArtworkImage,
	BackToGallery,
	FullSizeLink,
	ShareActions,
} from "#/components/gallery/artwork-page";
import {
	ArtworkColumns,
	ArtworkCredit,
} from "#/components/gallery/artwork-tile";
import {
	BookingActions,
	Facts,
	StyleLinks,
} from "#/components/profile/profile";
import {
	artworkTitle,
	loadArtwork,
	relatedQueries,
	relatedWork,
} from "#/lib/artwork";
import { bookingLinks } from "#/lib/booking";
import { crumbs } from "#/lib/breadcrumbs";
import { countryName } from "#/lib/country";
import { tattooProfile } from "#/lib/destinations";
import { placeLine, possessive } from "#/lib/profiles";
import { paths } from "#/lib/routes";
import { canonicalUrl, pageMeta } from "#/lib/seo";
import { structuredData } from "#/lib/structured-data";

/**
 * `/tattoos/:slug` (D09): one published photo, artwork first. The slug is
 * the API's photo id (src/lib/artwork.ts); anything the API doesn't show is
 * the 404 page, a non-canonical spelling a 301. Metadata only from the
 * answer (its alt text, styles, artist, studio, place); booking through
 * `bookingLinks` (the storefront's "Request a similar tattoo", `artwork`);
 * related work composed from the tattoos list (the artist's, and the
 * style's in the page's country).
 */
export const Route = createFileRoute("/tattoos/$slug")({
	loaderDeps: ({ search }) => ({
		country: (search as { country?: string }).country,
	}),
	loader: ({ context, params }) => loadArtwork(context, params.slug),
	head: (context) => ({
		meta: context.loaderData
			? [
					...pageMeta(context.loaderData.seo),
					...structuredData(context, context.loaderData.structured),
				]
			: [],
	}),
	component: Artwork,
});

function Artwork() {
	const { discover, country } = Route.useRouteContext();
	const { slug } = Route.useParams();
	const explicit = (Route.useSearch() as { country?: string }).country;
	// The loader 301s any other spelling, so the address is the canonical id.
	const tattoo = useSuspenseQuery(
		discoverQueries.tattoo(discover.client, slug),
	).data;
	const queries = relatedQueries(discover.client, tattoo, country.country);
	const reads: (typeof queries.byArtist)[] = queries.byStyle
		? [queries.byArtist, queries.byStyle]
		: [queries.byArtist];
	const [artistRead, styleRead] = useQueries({ queries: reads });
	const related = relatedWork(
		tattoo.id,
		artistRead?.data?.data,
		styleRead?.data?.data,
	);
	const style = tattoo.styles[0];
	const title = artworkTitle(tattoo);
	const independent = tattoo.studio.type === "independent";
	const artistPath = tattooProfile(tattoo);
	const where = placeLine(tattoo.location);
	const market =
		tattoo.location &&
		discover.settings.markets.includes(tattoo.location.country)
			? tattoo.location
			: null;

	// Booking (D08's rules): the storefront's "Request a similar tattoo".
	// An artist who isn't taking requests: a studio's piece still has the
	// studio's general request (the storefront falls back to it), an
	// independent's none.
	const { request, site } = bookingLinks(tattoo, undefined, tattoo.id);
	const accepting = tattoo.artistAcceptingInquiries;
	const shownRequest = accepting || !independent ? request : null;
	const owner = possessive(
		independent ? tattoo.artist.name : tattoo.studio.name,
	);

	return (
		<>
			<PageContainer className="pt-6 lg:pt-10">
				<Breadcrumbs items={crumbs.artwork(title)} />
			</PageContainer>
			<article aria-labelledby="artwork-title">
				<PageContainer className="grid gap-8 pt-6 pb-12 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-12 lg:pt-10 lg:pb-20">
					<div className="flex min-w-0 flex-col items-center gap-2">
						<ArtworkImage tattoo={tattoo} />
						<FullSizeLink tattoo={tattoo} />
					</div>
					<div className="flex min-w-0 flex-col gap-6 lg:sticky lg:top-24 lg:self-start">
						<div className="flex flex-col gap-3">
							<p className="eyebrow text-muted-foreground">
								{tattoo.healed ? "Healed tattoo" : "Tattoo"}
							</p>
							<h1
								id="artwork-title"
								className="font-display text-display-lg font-bold break-words"
							>
								{title}
							</h1>
						</div>
						<Facts
							items={[
								{
									term: "Artist",
									value: artistPath ? (
										<Link
											to={artistPath}
											preload={false}
											className="font-medium underline underline-offset-4"
										>
											{tattoo.artist.name}
										</Link>
									) : (
										tattoo.artist.name
									),
								},
								{
									term: "Studio",
									value: independent ? (
										"Independent artist"
									) : (
										<Link
											to={paths.studio(tattoo.studio.slug)}
											preload={false}
											className="font-medium underline underline-offset-4"
										>
											{tattoo.studio.name}
										</Link>
									),
								},
								{
									term: "Styles",
									value: tattoo.styles.length > 0 && (
										<StyleLinks styles={tattoo.styles} />
									),
								},
								{
									term: "Where",
									value: market ? (
										<Link
											to={paths.city(market.country, market.slug)}
											className="underline underline-offset-4"
										>
											{where}
										</Link>
									) : (
										where
									),
								},
								{ term: "Condition", value: tattoo.healed && "Healed" },
							]}
						/>
						<BookingActions
							request={shownRequest}
							requestLabel={
								accepting
									? "Request a similar tattoo"
									: `Request a similar tattoo at ${tattoo.studio.name}`
							}
							site={site}
							siteLabel={
								independent ? "View on their site" : "View on studio site"
							}
							owner={owner}
							closed={
								accepting
									? undefined
									: `${tattoo.artist.name} isn't taking new requests right now.`
							}
						/>
						<ShareActions
							url={canonicalUrl(discover.settings, paths.tattoo(tattoo.id))}
							title={title}
						/>
						<BackToGallery />
					</div>
				</PageContainer>
			</article>

			{related.byArtist.length > 0 && (
				<HubSection
					id="artwork-artist-title"
					tone="night"
					eyebrow="Same artist"
					title={`More by ${tattoo.artist.name}`}
					more={
						<MoreLink
							to={paths.tattoos()}
							search={{ artist: tattoo.artist.id }}
						>
							{`All work by ${tattoo.artist.name}`}
						</MoreLink>
					}
				>
					<ArtworkColumns
						tattoos={related.byArtist}
						caption={(each) => (
							<ArtworkCredit
								tattoo={each}
								artist={false}
								studio={false}
								style
							/>
						)}
					/>
				</HubSection>
			)}
			{style && related.byStyle.length > 0 && (
				<HubSection
					id="artwork-style-title"
					eyebrow="Same style"
					title={`More ${style.name} work`}
					intro={`Recently published in ${countryName(country.country)}.`}
					more={
						<MoreLink
							to={paths.tattoos()}
							search={{ style: style.slug, country: explicit }}
						>
							{`All ${style.name} tattoos`}
						</MoreLink>
					}
				>
					<ArtworkColumns tattoos={related.byStyle} tone="paper" />
				</HubSection>
			)}
		</>
	);
}
