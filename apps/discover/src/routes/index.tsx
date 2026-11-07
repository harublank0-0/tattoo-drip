import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { PageContainer } from "#/components/discovery/layout";
import { HomeHero } from "#/components/home/hero";
import {
	ArtistsSection,
	BookingSteps,
	FinalCta,
	InspirationSection,
	LocationsSection,
	StudioOsBand,
	StudiosSection,
	StylesSection,
} from "#/components/home/sections";
import { EmptyMarket } from "#/components/layout/country-selector";
import {
	enough,
	HOME_CAPS,
	HOME_THRESHOLDS,
	type HomeRead,
	heroPhotos,
	homeQueries,
	inspirationPhotos,
	pairStylesWithPhotos,
	placesIn,
} from "#/lib/home";
import { pageMeta } from "#/lib/seo";

const READS: HomeRead[] = [
	"tattoos",
	"studios",
	"artists",
	"styles",
	"locations",
];

/**
 * `/`: the discovery homepage (D06). The loader prefetches the five reads
 * in parallel and never throws (`Promise.allSettled`): a failed read only
 * hides its section. The sections read the same query options with
 * `useQuery`, so the server's answers are reused in the browser. Every
 * data section hides below its threshold (`HOME_THRESHOLDS`); with no
 * data the page is the hero, how booking works, the Studio OS band and the
 * closing call, and with every read failed the hero adds a quiet note.
 *
 * Country-aware (D06.5): studios, artists, photos and places are the page's
 * country's (`context.country`: `?country=`, else the visitor's
 * preference). A country with nothing listed says so and offers the other
 * markets; it never borrows another country's listings. The country is a
 * loader dependency, and a switch re-runs the loader (`router.invalidate`).
 */
export const Route = createFileRoute("/")({
	loaderDeps: ({ search }) => ({ country: search.country }),
	loader: async ({ context }) => {
		const { country } = context.country;
		const queries = homeQueries(context.discover.client, country);
		const { queryClient } = context;
		const results = await Promise.allSettled([
			queryClient.ensureQueryData(queries.tattoos),
			queryClient.ensureQueryData(queries.studios),
			queryClient.ensureQueryData(queries.artists),
			queryClient.ensureQueryData(queries.styles),
			queryClient.ensureQueryData(queries.locations),
		]);
		// Loader data travels to the browser, so both sides agree on the note.
		return {
			country,
			failed: READS.filter((_, index) => results[index]?.status === "rejected"),
		};
	},
	head: () => ({
		meta: pageMeta({
			description:
				"Find a tattoo artist or studio: browse real studios, independent artists and their published work, then send your request on the studio's own site.",
		}),
	}),
	component: Home,
});

function Home() {
	const router = useRouter();
	const { discover } = Route.useRouteContext();
	// The country the loader read: the queries below are the same ones.
	const { country, failed } = Route.useLoaderData();
	const queries = homeQueries(discover.client, country);
	const tattoos = useQuery(queries.tattoos).data?.data;
	const studios = useQuery(queries.studios).data?.data;
	const artists = useQuery(queries.artists).data?.data;
	const styles = useQuery(queries.styles).data;
	const locations = placesIn(useQuery(queries.locations).data, country);

	const photos = tattoos ?? [];
	const hero = heroPhotos(photos);
	const stylePairs = styles ? pairStylesWithPhotos(styles, photos) : [];
	const inspiration = inspirationPhotos(photos, hero);
	const nothing = [tattoos, studios, artists, styles, locations].every(
		(data) => data === undefined,
	);

	return (
		<>
			<HomeHero
				photos={hero}
				unavailable={failed.length === READS.length && nothing}
				onRetry={() => router.invalidate()}
			/>
			{studios?.length === 0 && (
				<section
					aria-labelledby="market-empty-title"
					className="border-b border-line"
				>
					<PageContainer className="py-12">
						<EmptyMarket
							id="market-empty-title"
							country={country}
							markets={discover.settings.markets}
							noun="studios"
						/>
					</PageContainer>
				</section>
			)}
			{stylePairs.length > 0 && <StylesSection pairs={stylePairs} />}
			{enough(studios, HOME_THRESHOLDS.studios) && (
				<StudiosSection studios={studios} />
			)}
			{enough(artists, HOME_THRESHOLDS.artists) && (
				<ArtistsSection artists={artists} tattoos={photos} />
			)}
			{inspiration.length > 0 && <InspirationSection tattoos={inspiration} />}
			{enough(locations, HOME_THRESHOLDS.locations) && (
				<LocationsSection locations={locations.slice(0, HOME_CAPS.locations)} />
			)}
			<BookingSteps />
			<StudioOsBand />
			<FinalCta />
		</>
	);
}
