import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ArtistProfile } from "#/components/profile/artist-profile";
import { independentQueries, loadIndependentProfile } from "#/lib/profiles";
import { pageMeta } from "#/lib/seo";
import { structuredData } from "#/lib/structured-data";

/**
 * `/artists/:tenantSlug` (D08): an independent artist's profile, by their
 * business's (tenant's) slug, never the artist's own. A studio's slug, and
 * anything the API doesn't show, is the 404 page; an old slug is a 301.
 */
export const Route = createFileRoute("/artists/$tenantSlug")({
	loader: ({ context, params }) =>
		loadIndependentProfile(context, params.tenantSlug),
	head: (context) => ({
		meta: context.loaderData
			? [
					...pageMeta(context.loaderData.seo),
					...structuredData(context, context.loaderData.structured),
				]
			: [],
	}),
	component: IndependentProfile,
});

function IndependentProfile() {
	const { discover } = Route.useRouteContext();
	const { tenantSlug } = Route.useParams();
	const queries = independentQueries(discover.client, tenantSlug);
	const artist = useSuspenseQuery(queries.artist).data;
	const reviews = useQuery(queries.reviews).data;
	const freshInk = useQuery(queries.freshInk).data;
	return (
		<ArtistProfile
			artist={artist}
			markets={discover.settings.markets}
			subject={{ kind: "independent", slug: tenantSlug }}
			reviews={reviews}
			freshInk={freshInk}
		/>
	);
}
