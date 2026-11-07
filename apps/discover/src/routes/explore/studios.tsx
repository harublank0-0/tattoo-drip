import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { discoverQueries } from "@tattoo-drip/react";
import { ArrowUpRightIcon } from "lucide-react";
import { DiscoverySearch } from "#/components/discovery/discovery-search";
import { PageContainer, PageHeader } from "#/components/discovery/layout";
import { EmptyState } from "#/components/discovery/states";
import { paths } from "#/lib/routes";
import { readQuery } from "#/lib/search";
import { pageMeta } from "#/lib/seo";

/**
 * `/explore/studios` (D05): the foundation's one page on live data, and the
 * pattern later pages follow. The loader prefetches the Discover API's
 * first page on the server (`discoverQueries`, D03), the cache is streamed
 * to the browser, and the component reads the same query. The finished
 * directory (filters, cards, paging) is D07; rows link to each studio's own
 * page until Discover's profiles exist (D08).
 */
export const Route = createFileRoute("/explore/studios")({
	validateSearch: (search: Record<string, unknown>): { q?: string } => {
		const q = readQuery(search.q);
		return q ? { q } : {};
	},
	loaderDeps: ({ search }) => ({ q: search.q }),
	loader: ({ context, deps }) =>
		context.queryClient.ensureQueryData(
			discoverQueries.studios(
				context.discover.client,
				deps.q ? { query: deps.q } : undefined,
			),
		),
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

function Studios() {
	const { q } = Route.useSearch();
	const { discover } = Route.useRouteContext();
	const { data } = useSuspenseQuery(
		discoverQueries.studios(discover.client, q ? { query: q } : undefined),
	);

	return (
		<>
			<PageHeader
				title="Explore studios"
				intro="Studios that list themselves on Discover. Filters, profiles and more of each studio's work are on their way."
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
				{data.data.length === 0 ? (
					<EmptyState
						title={q ? `No studios match "${q}"` : "No studios listed yet"}
					>
						{q
							? "Try a shorter or different name."
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
