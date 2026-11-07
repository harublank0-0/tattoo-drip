import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { DiscoverySearch } from "#/components/discovery/discovery-search";
import { PageContainer, PageHeader } from "#/components/discovery/layout";
import { EmptyState } from "#/components/discovery/states";
import { CountryForm, EmptyMarket } from "#/components/layout/country-selector";
import { buttonVariants } from "#/components/ui/button";
import { countryName, countryOptions } from "#/lib/country";
import {
	activeFilterCount,
	applyFilters,
	changeSearch,
	clearedSearch,
	type DirectoryFilters,
	type DirectoryKind,
	type DirectorySearch,
	filterChips,
	hasSearchParams,
	searchFields,
} from "#/lib/directory";
import { paths } from "#/lib/routes";
import {
	ActiveFilters,
	type FilterLists,
	FilterToolbar,
	MobileFilters,
} from "./filters.tsx";
import { Pagination } from "./pagination.tsx";

const COPY = {
	studios: {
		title: "Explore studios",
		noun: "studios",
		Noun: "Studios",
		crumb: "Studios",
		searchLabel: "Search studios by name",
		placeholder: "Studio name",
		intro: (country: string) =>
			`Tattoo studios in ${country} that list themselves on Discover. Each one takes requests on its own site.`,
	},
	artists: {
		title: "Find artists",
		noun: "artists",
		Noun: "Artists",
		crumb: "Find artists",
		searchLabel: "Search artists by name",
		placeholder: "Artist name",
		intro: (country: string) =>
			`Tattoo artists in ${country}, at listed studios and independent, with their recent work.`,
	},
} as const;

/**
 * A directory page (D07, `/explore/studios` and `/explore/artists`): the
 * name search, the filter toolbar (a sheet on mobile), the active filters,
 * the results (`children`: each directory's own presentation), the states
 * and cursor paging. Everything lives in the address: every control
 * navigates, and the loader reads the API with exactly what the address
 * says, so back/forward, reloads and shared links show the same page.
 */
export function DirectoryPage({
	kind,
	search,
	filters,
	lists,
	markets,
	rows,
	nextCursor,
	styleUnchecked = false,
	children,
}: {
	kind: DirectoryKind;
	/** The address (validated), for links that keep what it says. */
	search: DirectorySearch;
	/** What the page was read with (the loader's). */
	filters: DirectoryFilters;
	lists: FilterLists;
	markets: readonly string[];
	/** How many rows this page has. */
	rows: number;
	nextCursor: string | null;
	/** The address named a style the loader couldn't check (`/styles` failed), so it dropped it. */
	styleUnchecked?: boolean;
	children: ReactNode;
}) {
	const copy = COPY[kind];
	const action = kind === "studios" ? paths.studios() : paths.artists();
	const navigate = useNavigate();
	const go = (next: DirectorySearch) =>
		navigate({ to: action, search: next as never });
	// Loading the next address: the current results stay, dimmed and busy.
	const pending = useRouterState({
		select: (state) => state.status === "pending",
	});
	const country = countryName(filters.country);
	const chips = filterChips(search, filters, lists);
	const filtered = activeFilterCount(filters) > 0 || Boolean(filters.q);
	const cleared = clearedSearch(search);
	const reset = hasSearchParams({ ...search, country: undefined })
		? cleared
		: undefined;

	return (
		<>
			<PageHeader
				title={copy.title}
				intro={copy.intro(country)}
				breadcrumbs={[
					{ label: "Discover", to: paths.home() },
					{ label: copy.crumb },
				]}
			>
				<DiscoverySearch
					// Remounted per search, so the box shows the address's text.
					key={filters.q ?? ""}
					action={action}
					label={copy.searchLabel}
					placeholder={copy.placeholder}
					defaultValue={filters.q ?? ""}
					hidden={searchFields(search, ["q"])}
					onSearch={(q) => go(changeSearch(search, { q }))}
					pending={pending}
					className="max-w-2xl"
				/>
			</PageHeader>
			<PageContainer className="flex flex-col gap-6 py-8 lg:py-10">
				<div className="flex flex-col gap-4">
					<FilterToolbar
						kind={kind}
						action={action}
						search={search}
						filters={filters}
						lists={lists}
						onApply={(draft) =>
							go(applyFilters(search, draft, filters.country))
						}
						resetSearch={reset}
					/>
					<MobileFilters
						kind={kind}
						filters={filters}
						lists={lists}
						onApply={(draft) =>
							go(applyFilters(search, draft, filters.country))
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
					aria-labelledby="results-title"
					aria-busy={pending || undefined}
					className={pending ? "opacity-60 transition-opacity" : undefined}
				>
					<h2 id="results-title" className="sr-only">
						{filters.q
							? `${copy.Noun} matching "${filters.q}"`
							: `${copy.Noun} in ${country}`}
					</h2>
					{/* Announced politely when a new page of results arrives. */}
					<output className="sr-only">
						{rows === 0
							? `No ${copy.noun} found.`
							: `${rows} ${rows === 1 ? copy.noun.slice(0, -1) : copy.noun} shown${nextCursor ? ", more on the next page" : ""}.`}
					</output>
					{rows > 0 ? (
						children
					) : search.cursor ? (
						<EmptyState
							title={`No more ${copy.noun}`}
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
							{`That's every ${copy.noun.slice(0, -1)} for these filters.`}
						</EmptyState>
					) : filtered ? (
						<FilteredEmpty
							kind={kind}
							action={action}
							search={search}
							filters={filters}
							lists={lists}
							markets={markets}
						/>
					) : (
						<EmptyMarket
							country={filters.country}
							markets={markets}
							noun={kind}
							className="border-t border-line py-12"
						/>
					)}
					<Pagination
						action={action}
						search={search}
						nextCursor={nextCursor}
						noun={copy.noun}
					/>
				</section>
			</PageContainer>
		</>
	);
}

/**
 * Nothing matches the search or filters: say so, and offer what helps:
 * clearing them, the whole country instead of the city, the style pages,
 * another market (the country selector's form). Never another country's
 * listings in their place.
 */
function FilteredEmpty({
	kind,
	action,
	search,
	filters,
	lists,
	markets,
}: {
	kind: DirectoryKind;
	action: string;
	search: DirectorySearch;
	filters: DirectoryFilters;
	lists: FilterLists;
	markets: readonly string[];
}) {
	const copy = COPY[kind];
	const country = countryName(filters.country);
	const others = countryOptions(markets, filters.country).filter(
		(code) => code !== filters.country,
	);
	const styles = (lists.styles ?? [])
		.filter((style) => style.slug !== filters.style)
		.slice(0, 6);
	return (
		<EmptyState
			title={
				filters.q
					? `No ${copy.noun} match "${filters.q}"`
					: `No ${copy.noun} match these filters`
			}
			action={
				<div className="flex flex-col gap-6">
					<div className="flex flex-wrap gap-3">
						<Link
							to={action}
							search={clearedSearch(search) as never}
							className={buttonVariants({ variant: "primary" })}
						>
							Clear filters
						</Link>
						{filters.city && (
							<Link
								to={action}
								search={changeSearch(search, { city: undefined }) as never}
								className={buttonVariants({ variant: "outline" })}
							>
								{`All of ${country}`}
							</Link>
						)}
					</div>
					{styles.length > 0 && (
						<div className="flex flex-col gap-2">
							<p className="text-sm text-ink-muted">Browse a style instead</p>
							<ul className="flex flex-wrap gap-x-5 gap-y-1">
								{styles.map((style) => (
									<li key={style.slug}>
										<Link
											to={paths.style(style.slug)}
											className="inline-flex min-h-11 items-center font-medium underline underline-offset-4"
										>
											{style.name}
										</Link>
									</li>
								))}
							</ul>
						</div>
					)}
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
										{`${copy.Noun} in ${countryName(code)}`}
									</button>
								))}
							</CountryForm>
						</div>
					)}
				</div>
			}
		>
			{filters.q
				? `Search looks at ${copy.noun.slice(0, -1)} names in ${country}. Try a shorter or different name, or remove a filter.`
				: `No listed ${copy.noun.slice(0, -1)} in ${country} matches yet. Remove a filter to see more.`}
		</EmptyState>
	);
}
