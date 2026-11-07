import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { discoverQueries } from "@tattoo-drip/react";
import { ArrowUpRightIcon } from "lucide-react";
import { PageContainer, PageHeader } from "#/components/discovery/layout";
import { EmptyState } from "#/components/discovery/states";
import { buttonVariants } from "#/components/ui/button";
import { rethrowUnavailable } from "#/lib/api-errors";
import { artistAffiliation } from "#/lib/home";
import { paths } from "#/lib/routes";
import { pageMeta } from "#/lib/seo";

/**
 * `/explore/artists` (D06): the API's first page of artists, studio-affiliated
 * and independent, in its own order (most recently added first), each
 * linking to their page on the studio's site. Search, filters and paging
 * are D07, Discover's own profiles D08. Never indexed while unfinished.
 */
export const Route = createFileRoute("/explore/artists")({
	loader: ({ context }) =>
		context.queryClient
			.ensureQueryData(discoverQueries.artists(context.discover.client))
			.catch(rethrowUnavailable),
	head: () => ({
		meta: pageMeta({
			title: "Find artists",
			description:
				"Tattoo artists listed on Tattoo Drip Discover, at studios and independent.",
			noindex: true,
		}),
	}),
	component: Artists,
});

function Artists() {
	const { discover } = Route.useRouteContext();
	const { data } = useSuspenseQuery(discoverQueries.artists(discover.client));

	return (
		<>
			<PageHeader
				title="Find artists"
				intro="Artists at listed studios and independent artists, the most recently added first. Search and filters are on their way."
				breadcrumbs={[
					{ label: "Discover", to: paths.home() },
					{ label: "Find artists" },
				]}
			/>
			<PageContainer className="py-12">
				{data.data.length === 0 ? (
					<EmptyState
						title="No artists listed yet"
						action={
							<Link
								to={paths.studios()}
								className={buttonVariants({ variant: "outline" })}
							>
								Explore studios
							</Link>
						}
					>
						Artists appear here once their studio, or they themselves, choose to
						list on Discover.
					</EmptyState>
				) : (
					<>
						<h2 className="sr-only">Artists</h2>
						<ul className="border-t border-ink">
							{data.data.map((artist) => (
								<li key={artist.id} className="border-b border-line">
									<a
										href={artist.storefrontUrl}
										className="group grid min-h-20 gap-1 py-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6"
									>
										<span className="flex flex-col gap-1">
											<span className="font-display text-display-md font-bold">
												{artist.name}
											</span>
											<span className="text-sm text-ink">
												{artistAffiliation(artist)}
											</span>
										</span>
										<span className="flex items-center gap-2 text-sm text-ink-muted">
											{artist.styles
												.slice(0, 3)
												.map((style) => style.name)
												.join(" · ")}
											<ArrowUpRightIcon className="size-4" aria-hidden="true" />
											<span className="sr-only">
												(their page on the studio's site)
											</span>
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
