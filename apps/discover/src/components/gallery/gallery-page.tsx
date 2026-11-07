import {
	Link,
	useNavigate,
	useRouter,
	useRouterState,
} from "@tanstack/react-router";
import type { DiscoverTattooSummary } from "@tattoo-drip/sdk";
import {
	ActiveFilters,
	type FilterLists,
	FilterToolbar,
	MobileFilters,
} from "#/components/directory/filters";
import { Pagination } from "#/components/directory/pagination";
import { PageContainer, PageHeader } from "#/components/discovery/layout";
import { EmptyState } from "#/components/discovery/states";
import { CountryForm, EmptyMarket } from "#/components/layout/country-selector";
import { buttonVariants } from "#/components/ui/button";
import { countryName, countryOptions } from "#/lib/country";
import type { DirectorySearch } from "#/lib/directory";
import {
	applyGalleryFilters,
	changeGallery,
	clearedGallery,
	GALLERY_EAGER,
	type GalleryFilters,
	type GalleryLabels,
	type GallerySearch,
	galleryChips,
	galleryFields,
	galleryTitle,
	isFiltered,
} from "#/lib/gallery";
import { paths } from "#/lib/routes";
import { ArtworkColumns, ArtworkCredit } from "./artwork-tile.tsx";
import { GallerySearchBox } from "./gallery-search.tsx";

/**
 * The tattoo gallery (D09, `/tattoos`): an editorial header with the
 * search, the D07 filter toolbar (a sheet on mobile; style and city, no
 * sort: the API has one order), the active filters, the masonry and
 * cursor paging. Everything lives in the address, as the directories: the
 * loader reads exactly what it says, so back/forward, reloads and shared
 * links show the same page. While the next address loads, the current
 * photos stay, dimmed and `aria-busy`.
 */
export function GalleryPage({
	search,
	filters,
	labels,
	lists,
	markets,
	tattoos,
	nextCursor,
	styleUnchecked,
	busy = false,
}: {
	search: GallerySearch;
	filters: GalleryFilters;
	labels: GalleryLabels;
	lists: FilterLists;
	markets: readonly string[];
	tattoos: readonly DiscoverTattooSummary[];
	nextCursor: string | null;
	styleUnchecked: boolean;
	/** A search the API rate-limited: a notice instead of results. */
	busy?: boolean;
}) {
	const action = paths.tattoos();
	const navigate = useNavigate();
	const go = (next: GallerySearch) =>
		navigate({ to: action, search: next as never });
	const pending = useRouterState({
		select: (state) => state.status === "pending",
	});
	const cleared = clearedGallery(search);
	const chips = galleryChips(search, filters, labels);
	const where = filters.country ? countryName(filters.country) : undefined;
	const heading = galleryTitle(filters, labels);
	const reset = Object.entries(search).some(
		([key, value]) => key !== "country" && value !== undefined,
	)
		? cleared
		: undefined;

	return (
		<>
			<PageHeader
				eyebrow="Gallery"
				title="Tattoo inspiration"
				intro={`The newest work published by listed studios and independent artists${where ? ` in ${where}` : ""}. Open a piece to see who made it and ask for something similar.`}
				breadcrumbs={[
					{ label: "Discover", to: paths.home() },
					{ label: "Tattoo inspiration" },
				]}
			>
				<GallerySearchBox search={search} q={filters.q} />
			</PageHeader>
			<PageContainer className="flex flex-col gap-6 py-8 lg:py-10">
				<div className="flex flex-col gap-4">
					<FilterToolbar
						kind="tattoos"
						action={action}
						search={search as DirectorySearch}
						filters={filters as DirectorySearch}
						lists={lists}
						onApply={(draft) =>
							go(applyGalleryFilters(search, draft, filters.country))
						}
						resetSearch={reset}
						hidden={galleryFields(
							{ ...search, country: search.country ?? filters.country },
							["city", "style"],
						)}
					/>
					<MobileFilters
						kind="tattoos"
						filters={filters as DirectorySearch}
						lists={lists}
						onApply={(draft) =>
							go(applyGalleryFilters(search, draft, filters.country))
						}
						onReset={() => go(cleared)}
					/>
					<ActiveFilters action={action} chips={chips} clearAll={cleared} />
					{styleUnchecked && (
						<p className="text-sm text-ink-muted">
							Styles are unavailable right now, so this gallery isn't filtered
							by style.
						</p>
					)}
				</div>
				<section
					aria-labelledby="gallery-results-title"
					aria-busy={pending || undefined}
					className={pending ? "opacity-60 transition-opacity" : undefined}
				>
					<h2 id="gallery-results-title" className="sr-only">
						{heading}
					</h2>
					{busy ? (
						<GalleryBusy />
					) : (
						<GalleryResults
							search={search}
							filters={filters}
							lists={lists}
							markets={markets}
							tattoos={tattoos}
							nextCursor={nextCursor}
						/>
					)}
				</section>
			</PageContainer>
		</>
	);
}

/**
 * The API rate-limited this search (429): say so politely and offer the
 * same address again; the search box, filters and chips stay above.
 */
function GalleryBusy() {
	const router = useRouter();
	const href = useRouterState({ select: (state) => state.location.href });
	return (
		<div className="flex flex-col items-start gap-4 border-t border-line py-12">
			{/* Announced politely, as the results' count would be. */}
			<output className="block max-w-xl text-lg">
				Searching is busy right now. Try again in a moment.
			</output>
			<a
				href={href}
				onClick={(event) => {
					// With JavaScript: read the same address again in place.
					event.preventDefault();
					router.invalidate();
				}}
				className={buttonVariants({ variant: "outline" })}
			>
				Try again
			</a>
		</div>
	);
}

/** The photos, or what to do when there are none, and the paging. */
function GalleryResults({
	search,
	filters,
	lists,
	markets,
	tattoos,
	nextCursor,
}: {
	search: GallerySearch;
	filters: GalleryFilters;
	lists: FilterLists;
	markets: readonly string[];
	tattoos: readonly DiscoverTattooSummary[];
	nextCursor: string | null;
}) {
	const action = paths.tattoos();
	const filtered = isFiltered(filters);
	const rows = tattoos.length;
	return (
		<>
			{/* Announced politely when new results arrive (typing, filters, paging). */}
			<output className="sr-only">
				{rows === 0
					? "No tattoos found."
					: `${rows} ${rows === 1 ? "tattoo" : "tattoos"} shown${nextCursor ? ", more on the next page" : ""}.`}
			</output>
			{rows > 0 ? (
				<ArtworkColumns
					tattoos={tattoos}
					tone="paper"
					eager={search.cursor ? 0 : GALLERY_EAGER}
					fromGallery
					sizes="(min-width: 64rem) 24vw, (min-width: 40rem) 33vw, 50vw"
					caption={(tattoo) => <ArtworkCredit tattoo={tattoo} style />}
				/>
			) : search.cursor ? (
				<EmptyState
					title="No more tattoos"
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
					That's every published piece for these filters.
				</EmptyState>
			) : filtered || !filters.country ? (
				<GalleryEmpty
					search={search}
					filters={filters}
					lists={lists}
					markets={markets}
				/>
			) : (
				<EmptyMarket
					country={filters.country}
					markets={markets}
					noun="tattoos"
					className="border-t border-line py-12"
				/>
			)}
			<Pagination
				action={action}
				search={search}
				nextCursor={nextCursor}
				noun="tattoos"
			/>
		</>
	);
}

/**
 * Nothing matches: say what, and offer what helps (clear the filters, the
 * whole country instead of the city, another style, another market). Never
 * another country's work in its place.
 */
function GalleryEmpty({
	search,
	filters,
	lists,
	markets,
}: {
	search: GallerySearch;
	filters: GalleryFilters;
	lists: FilterLists;
	markets: readonly string[];
}) {
	const action = paths.tattoos();
	const where = filters.country ? countryName(filters.country) : undefined;
	const others = filters.country
		? countryOptions(markets, filters.country).filter(
				(code) => code !== filters.country,
			)
		: [];
	const styles = (lists.styles ?? [])
		.filter((style) => style.slug !== filters.style)
		.slice(0, 6);
	return (
		<EmptyState
			title={
				filters.q
					? `No tattoos match "${filters.q}"`
					: "No tattoos match these filters"
			}
			action={
				<div className="flex flex-col gap-6">
					<div className="flex flex-wrap gap-3">
						<Link
							to={action}
							search={clearedGallery(search) as never}
							className={buttonVariants({ variant: "primary" })}
						>
							Clear filters
						</Link>
						{filters.city && where && (
							<Link
								to={action}
								search={changeGallery(search, { city: undefined }) as never}
								className={buttonVariants({ variant: "outline" })}
							>
								{`All of ${where}`}
							</Link>
						)}
					</div>
					{styles.length > 0 && (
						<div className="flex flex-col gap-2">
							<p className="text-sm text-ink-muted">Try another style</p>
							<ul className="flex flex-wrap gap-x-5 gap-y-1">
								{styles.map((style) => (
									<li key={style.slug}>
										<Link
											to={action}
											search={
												changeGallery(search, {
													style: style.slug,
													q: undefined,
												}) as never
											}
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
										{`Tattoos in ${countryName(code)}`}
									</button>
								))}
							</CountryForm>
						</div>
					)}
				</div>
			}
		>
			{filters.q
				? `Search looks at what studios wrote about a piece and at artist, studio and style names${where ? ` in ${where}` : ""}. Try a shorter or different word, or remove a filter.`
				: `No published work${where ? ` in ${where}` : ""} matches yet. Remove a filter to see more.`}
		</EmptyState>
	);
}
