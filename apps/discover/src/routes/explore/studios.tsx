import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { discoverQueries } from "@tattoo-drip/react";
import { ArrowUpRightIcon, XIcon } from "lucide-react";
import { DiscoverySearch } from "#/components/discovery/discovery-search";
import { PageContainer, PageHeader } from "#/components/discovery/layout";
import { EmptyState } from "#/components/discovery/states";
import { buttonVariants } from "#/components/ui/button";
import { rethrowUnavailable } from "#/lib/api-errors";
import { paths } from "#/lib/routes";
import {
	countryName,
	humanizeSlug,
	knownStyle,
	readStudioSearch,
	type StudioSearch,
	studioQuery,
} from "#/lib/search";
import { pageMeta } from "#/lib/seo";

/**
 * `/explore/studios` (D05, filters D06): the API's first page of studios.
 * The loader prefetches it on the server (`discoverQueries`, D03), the
 * cache is streamed to the browser, and the component reads the same
 * query. D06 adds the parameters the homepage links with (`country`,
 * `city`, `style`, beside `q`), each validated and shown as a removable
 * chip; the filter UI, cards and paging are D07, profiles D08.
 */
export const Route = createFileRoute("/explore/studios")({
	// Always returns every key, undefined when malformed: the router merges
	// this over the raw search, so leaving a key out would let a bad value through.
	validateSearch: (search: Record<string, unknown>): StudioSearch =>
		readStudioSearch(search),
	loaderDeps: ({ search }) => ({
		q: search.q,
		country: search.country,
		city: search.city,
		style: search.style,
	}),
	loader: async ({ context, deps }) => {
		const { queryClient, discover } = context;
		// The style list (never stale) checks the style, since the API refuses
		// an unknown one; the places name the city's chip. Neither is required.
		const [styles] = await Promise.allSettled([
			queryClient.ensureQueryData(discoverQueries.styles(discover.client)),
			queryClient.ensureQueryData(discoverQueries.locations(discover.client)),
		]);
		const filters: StudioSearch = {
			...deps,
			style: knownStyle(
				deps.style,
				styles.status === "fulfilled" ? styles.value : undefined,
			),
		};
		await queryClient
			.ensureQueryData(
				discoverQueries.studios(discover.client, studioQuery(filters)),
			)
			.catch(rethrowUnavailable);
		// The filters the page was read with: the component asks for the same.
		return { filters };
	},
	head: ({ match }) => ({
		meta: pageMeta({
			title: match.search.q
				? `Studios matching "${match.search.q}"`
				: "Explore studios",
			description: "Tattoo studios listed on Tattoo Drip Discover.",
			// Unfinished and query-dependent: never indexed in this form.
			noindex: true,
		}),
	}),
	component: Studios,
});

type Chip = { key: string; label: string; remove: StudioSearch };

function Studios() {
	const { discover } = Route.useRouteContext();
	const { filters } = Route.useLoaderData();
	const { q } = filters;
	const { data } = useSuspenseQuery(
		discoverQueries.studios(discover.client, studioQuery(filters)),
	);
	// Names for the chips when the lists loaded; else the slug as words.
	const styles = useQuery(discoverQueries.styles(discover.client)).data;
	const places = useQuery(discoverQueries.locations(discover.client)).data;

	const chips: Chip[] = [];
	if (filters.city && filters.country) {
		const place = places?.find(
			(each) => each.country === filters.country && each.slug === filters.city,
		);
		chips.push({
			key: "city",
			label: place?.name ?? humanizeSlug(filters.city),
			remove: { ...filters, city: undefined },
		});
	}
	if (filters.country) {
		chips.push({
			key: "country",
			label: countryName(filters.country),
			// A city needs its country: removing the country removes both.
			remove: { ...filters, country: undefined, city: undefined },
		});
	}
	if (filters.style) {
		chips.push({
			key: "style",
			label:
				styles?.find((each) => each.slug === filters.style)?.name ??
				humanizeSlug(filters.style),
			remove: { ...filters, style: undefined },
		});
	}
	const filtered = chips.length > 0;

	return (
		<>
			<PageHeader
				title="Explore studios"
				intro="Studios that list themselves on Discover. More filters, profiles and more of each studio's work are on their way."
				breadcrumbs={[
					{ label: "Discover", to: paths.home() },
					{ label: "Studios" },
				]}
			>
				<DiscoverySearch
					// Remounted per search, so the box shows the address's text.
					key={q ?? ""}
					action={paths.studios()}
					label="Search studios by name"
					placeholder="Studio name"
					defaultValue={q ?? ""}
					className="max-w-2xl"
				/>
			</PageHeader>
			<PageContainer className="py-12">
				{filtered && (
					<div className="mb-8 flex flex-wrap items-center gap-2">
						<p className="mr-2 text-sm text-ink-muted" id="filters-label">
							Filtered by
						</p>
						<ul
							aria-labelledby="filters-label"
							className="flex flex-wrap gap-2"
						>
							{chips.map((chip) => (
								<li key={chip.key}>
									<Link
										to={paths.studios()}
										search={chip.remove}
										className="inline-flex min-h-11 items-center gap-2 rounded-[2px] border border-line-strong bg-paper-raised px-3 text-sm font-medium hover:border-ink lg:min-h-9"
									>
										{chip.label}
										<XIcon className="size-4" aria-hidden="true" />
										<span className="sr-only">(remove this filter)</span>
									</Link>
								</li>
							))}
						</ul>
					</div>
				)}
				{data.data.length === 0 ? (
					<EmptyState
						title={
							q
								? `No studios match "${q}"`
								: filtered
									? "No studios match these filters"
									: "No studios listed yet"
						}
						action={
							q || filtered ? (
								<Link
									to={paths.studios()}
									className={buttonVariants({ variant: "outline" })}
								>
									Show all studios
								</Link>
							) : undefined
						}
					>
						{q
							? "Try a shorter or different name."
							: filtered
								? "No listed studio matches yet. Remove a filter to see more."
								: "Studios appear here once they choose to list on Discover."}
					</EmptyState>
				) : (
					<>
						<h2 className="sr-only">
							{q ? `Studios matching "${q}"` : "Studios"}
						</h2>
						<ul className="border-t border-ink">
							{data.data.map((studio) => (
								<li key={studio.id} className="border-b border-line">
									<a
										href={studio.storefrontUrl}
										className="group grid min-h-20 gap-1 py-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6"
									>
										<span className="font-display text-display-md font-bold">
											{studio.name}
										</span>
										<span className="flex items-center gap-2 text-sm text-ink-muted">
											{[
												studio.location?.name,
												...studio.styles.slice(0, 2).map((style) => style.name),
											]
												.filter(Boolean)
												.join(" · ")}
											<ArrowUpRightIcon className="size-4" aria-hidden="true" />
											<span className="sr-only">(the studio's own page)</span>
										</span>
									</a>
								</li>
							))}
						</ul>
					</>
				)}
			</PageContainer>
		</>
	);
}
