import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
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
import {
	enough,
	HOME_CAPS,
	HOME_THRESHOLDS,
	type HomeRead,
	heroPhotos,
	homeQueries,
	inspirationPhotos,
	pairStylesWithPhotos,
	tattooDestination,
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
 */
export const Route = createFileRoute("/")({
	loader: async ({ context }) => {
		const queries = homeQueries(context.discover.client);
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
	const { failed } = Route.useLoaderData();
	const queries = homeQueries(discover.client);
	const tattoos = useQuery(queries.tattoos).data?.data;
	const studios = useQuery(queries.studios).data?.data;
	const artists = useQuery(queries.artists).data?.data;
	const styles = useQuery(queries.styles).data;
	const locations = useQuery(queries.locations).data;

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
			{stylePairs.length > 0 && <StylesSection pairs={stylePairs} />}
			{enough(studios, HOME_THRESHOLDS.studios) && (
				<StudiosSection studios={studios} />
			)}
			{enough(artists, HOME_THRESHOLDS.artists) && (
				<ArtistsSection artists={artists} tattoos={photos} />
			)}
			{inspiration.length > 0 && (
				<InspirationSection
					tattoos={inspiration}
					destination={(tattoo) => tattooDestination(tattoo, artists, studios)}
				/>
			)}
			{enough(locations, HOME_THRESHOLDS.locations) && (
				<LocationsSection locations={locations.slice(0, HOME_CAPS.locations)} />
			)}
			<BookingSteps />
			<StudioOsBand />
			<FinalCta />
		</>
	);
}
