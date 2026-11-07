import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ArtistProfile } from "#/components/profile/artist-profile";
import { independentQueries, loadIndependentProfile } from "#/lib/profiles";
import { pageMeta } from "#/lib/seo";

/**
 * `/artists/:tenantSlug` (D08): an independent artist's profile, by their
 * business's (tenant's) slug, never the artist's own. A studio's slug, and
 * anything the API doesn't show, is the 404 page; an old slug is a 301.
 */
export const Route = createFileRoute("/artists/$tenantSlug")({
	loader: ({ context, params }) =>
		loadIndependentProfile(context, params.tenantSlug),
	head: ({ loaderData }) => ({
		meta: loaderData ? pageMeta(loaderData.seo) : [],
	}),
	component: IndependentProfile,
});

function IndependentProfile() {
	const { discover } = Route.useRouteContext();
	const { tenantSlug } = Route.useParams();
	const artist = useSuspenseQuery(
		independentQueries(discover.client, tenantSlug).artist,
	).data;
	return <ArtistProfile artist={artist} markets={discover.settings.markets} />;
}
