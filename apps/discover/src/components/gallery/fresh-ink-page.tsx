import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import type { DiscoverFreshInkPost } from "@tattoo-drip/sdk";
import {
	ActiveFilters,
	type FilterLists,
	FilterToolbar,
	MobileFilters,
} from "#/components/directory/filters";
import { Pagination } from "#/components/directory/pagination";
import { PageContainer, PageHeader } from "#/components/discovery/layout";
import { EmptyState } from "#/components/discovery/states";
import { CountryForm } from "#/components/layout/country-selector";
import { buttonVariants } from "#/components/ui/button";
import { crumbs } from "#/lib/breadcrumbs";
import { countryName, countryOptions } from "#/lib/country";
import type { DirectorySearch } from "#/lib/directory";
import {
	applyFreshInkFilters,
	changeFreshInk,
	clearedFreshInk,
	FRESH_INK_EAGER,
	type FreshInkFilters,
	type FreshInkLabels,
	type FreshInkSearch,
	freshInkChips,
	freshInkFields,
	freshInkTitle,
} from "#/lib/fresh-ink";
import { paths } from "#/lib/routes";
import { FreshInkColumns } from "./fresh-ink.tsx";

/**
 * The Fresh ink feed (slice 4, `/fresh-ink`), in the gallery's shape (D09):
 * an editorial header, the D07 filter toolbar (style and city; a sheet on
 * mobile; a GET form without JavaScript), the active filters, the tiles in
 * columns and cursor paging. Everything lives in the address.
 */
export function FreshInkPage({
	search,
	filters,
	labels,
	lists,
	markets,
	posts,
	nextCursor,
	styleUnchecked,
}: {
	search: FreshInkSearch;
	filters: FreshInkFilters;
	labels: FreshInkLabels;
	lists: FilterLists;
	markets: readonly string[];
	posts: readonly DiscoverFreshInkPost[];
	nextCursor: string | null;
	styleUnchecked: boolean;
}) {
	const action = paths.freshInk();
	const navigate = useNavigate();
	const go = (next: FreshInkSearch) =>
		navigate({ to: action, search: next as never });
	const pending = useRouterState({
		select: (state) => state.status === "pending",
	});
	const cleared = clearedFreshInk(search);
	const chips = freshInkChips(search, filters, labels);
	const where = countryName(filters.country);
	const reset = Object.entries(search).some(
		([key, value]) => key !== "country" && value !== undefined,
	)
		? cleared
		: undefined;
	const rows = posts.length;
	return (
		<>
			<PageHeader
				eyebrow="Fresh ink"
				title="Fresh ink"
				intro={`Healed tattoos clients of listed studios in ${where} have posted, newest first. Each was posted through the studio's own review link, with the studio's approval. Open one to see every photo and video and who made it.`}
				breadcrumbs={crumbs.freshInk()}
			/>
			<PageContainer className="flex flex-col gap-6 py-8 lg:py-10">
				<div className="flex flex-col gap-4">
					<FilterToolbar
						kind="tattoos"
						action={action}
						search={search as DirectorySearch}
						filters={filters as DirectorySearch}
						lists={lists}
						onApply={(draft) =>
							go(applyFreshInkFilters(search, draft, filters.country))
						}
						resetSearch={reset}
						hidden={freshInkFields(
							{ ...search, country: search.country ?? filters.country },
							["city", "style"],
						)}
					/>
					<MobileFilters
						kind="tattoos"
						filters={filters as DirectorySearch}
						lists={lists}
						onApply={(draft) =>
							go(applyFreshInkFilters(search, draft, filters.country))
						}
						onReset={() => go(cleared)}
					/>
					<ActiveFilters action={action} chips={chips} clearAll={cleared} />
					{styleUnchecked && (
						<p className="text-sm text-ink-muted">
							Styles are unavailable right now, so this list isn't filtered by
							style.
						</p>
					)}
				</div>
				<section
					aria-labelledby="fresh-ink-results-title"
					aria-busy={pending || undefined}
					className={pending ? "opacity-60 transition-opacity" : undefined}
				>
					<h2 id="fresh-ink-results-title" className="sr-only">
						{freshInkTitle(filters, labels)}
					</h2>
					<output className="sr-only">
						{rows === 0
							? "No Fresh ink found."
							: `${rows} ${rows === 1 ? "post" : "posts"} shown${nextCursor ? ", more on the next page" : ""}.`}
					</output>
					{rows > 0 ? (
						<FreshInkColumns
							posts={posts}
							tone="paper"
							eager={search.cursor ? 0 : FRESH_INK_EAGER}
							sizes="(min-width: 64rem) 24vw, (min-width: 40rem) 33vw, 50vw"
						/>
					) : search.cursor ? (
						<EmptyState
							title="No more Fresh ink"
							action={
								<Link
									to={action}
									search={{ ...search, cursor: undefined } as never}
									className={buttonVariants({ variant: "outline" })}
								>
									First page
								</Link>
							}
						>
							That's every post for these filters.
						</EmptyState>
					) : (
						<FreshInkEmpty
							search={search}
							filters={filters}
							markets={markets}
						/>
					)}
					<Pagination
						action={action}
						search={search}
						nextCursor={nextCursor}
						noun="Fresh ink"
					/>
				</section>
			</PageContainer>
		</>
	);
}

/** Nothing to show: what to try instead; never another country's posts in their place. */
function FreshInkEmpty({
	search,
	filters,
	markets,
}: {
	search: FreshInkSearch;
	filters: FreshInkFilters;
	markets: readonly string[];
}) {
	const action = paths.freshInk();
	const where = countryName(filters.country);
	const filtered = Boolean(filters.city || filters.style);
	const others = countryOptions(markets, filters.country).filter(
		(code) => code !== filters.country,
	);
	return (
		<EmptyState
			title={
				filtered
					? "No Fresh ink matches these filters"
					: `No Fresh ink from ${where} yet`
			}
			action={
				<div className="flex flex-col gap-6">
					<div className="flex flex-wrap gap-3">
						{filtered && (
							<Link
								to={action}
								search={clearedFreshInk(search) as never}
								className={buttonVariants({ variant: "primary" })}
							>
								Clear filters
							</Link>
						)}
						{filters.city && (
							<Link
								to={action}
								search={changeFreshInk(search, { city: undefined }) as never}
								className={buttonVariants({ variant: "outline" })}
							>
								{`All of ${where}`}
							</Link>
						)}
						<Link
							to={paths.tattoos()}
							className={buttonVariants({ variant: "outline" })}
						>
							Tattoo inspiration
						</Link>
					</div>
					{others.length > 0 && (
						<div className="flex flex-col gap-2">
							<p className="text-sm text-ink-muted">Or another country</p>
							<CountryForm className="flex flex-wrap gap-3">
								{others.map((code) => (
									<button
										key={code}
										type="submit"
										name="country"
										value={code}
										className={buttonVariants({ variant: "outline" })}
									>
										{`Fresh ink from ${countryName(code)}`}
									</button>
								))}
							</CountryForm>
						</div>
					)}
				</div>
			}
		>
			{filtered
				? "Remove a filter to see more."
				: "Clients' healed tattoos appear here once studios approve them. Browse the studios' own work in the meantime."}
		</EmptyState>
	);
}
