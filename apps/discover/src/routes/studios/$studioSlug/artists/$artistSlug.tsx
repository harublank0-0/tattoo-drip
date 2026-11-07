import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ArtistProfile } from "#/components/profile/artist-profile";
import { loadStudioArtistProfile, studioArtistQueries } from "#/lib/profiles";
import { pageMeta } from "#/lib/seo";
import { structuredData } from "#/lib/structured-data";

/**
 * `/studios/:studioSlug/artists/:artistSlug` (D08): one artist at a listed
 * studio. An artist's slug is unique per studio only, so the studio's slug
 * comes first (`maya` at two studios is two profiles). Not shown by the API
 * (hidden, opted out, another studio's, an unlisted or taken-down studio)
 * is the 404 page; an old studio slug is a 301.
 */
export const Route = createFileRoute(
	"/studios/$studioSlug/artists/$artistSlug",
)({
	loader: ({ context, params }) =>
		loadStudioArtistProfile(context, params.studioSlug, params.artistSlug),
	head: (context) => ({
		meta: context.loaderData
			? [
					...pageMeta(context.loaderData.seo),
					...structuredData(context, context.loaderData.structured),
				]
			: [],
	}),
	component: StudioArtistProfile,
});

function StudioArtistProfile() {
	const { discover } = Route.useRouteContext();
	const { studioSlug, artistSlug } = Route.useParams();
	const queries = studioArtistQueries(discover.client, studioSlug, artistSlug);
	const artist = useSuspenseQuery(queries.artist).data;
	// Optional: when it failed, the section stays hidden (and is retried here).
	const colleagues = useQuery(queries.colleagues).data;
	return (
		<ArtistProfile
			artist={artist}
			colleagues={colleagues}
			markets={discover.settings.markets}
		/>
	);
}
