import { Link, router } from "@inertiajs/react";
import { cn } from "cn";
import {
	Check,
	CheckSquare,
	ChevronLeft,
	ChevronRight,
	ExternalLink,
	EyeOff,
	ImageOff,
	Plus,
	Search,
	Upload,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { urlFor } from "~/client";
import ArtworkDetails from "~/components/artwork_details";
import ArtworkUpload from "~/components/artwork_upload";
import FilterSelect from "~/components/filter_select";
import Page from "~/components/page";
import {
	isFiltered,
	NO_FILTERS,
	PAGE_DESCRIPTION,
	type PortfolioFilters,
	type PortfolioPageProps,
	type PortfolioPhoto,
	portfolioHref,
	resultLine,
	SORT_OPTIONS,
	STATUS_OPTIONS,
	statusText,
	tileLabel,
	tileMeta,
} from "~/components/portfolio";
import PortfolioBulkBar from "~/components/portfolio_bulk_bar";
import { Button, buttonVariants } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { useTenant } from "~/hooks/use-tenant";
import AppLayout from "~/layouts/app";

/**
 * The studio's portfolio (Studio OS): every work photo of the artists the
 * member may see as one image-first gallery, an owner every live artist's
 * and an artist their own. The address holds the search (description or
 * artist), the artist, style, status, healed and order filters and the
 * page, so a view can be kept or shared; the server reads and checks them
 * (PortfolioController). A tile opens the details panel; "Upload artwork"
 * opens the upload. Both write through the artist work photo routes with
 * `back`, so the gallery comes back as it was (an upload: that artist's
 * newest first, where the new work is). A photo is on the studio page while
 * its artist is: that is its status, and the panel says how to change it.
 */
export default function PortfolioIndex({
	photos,
	artists,
	styleOptions,
	filters,
	page,
	maxPhotos,
	isOwner,
	storefront,
}: PortfolioPageProps) {
	const tenant = useTenant();
	const base = urlFor("tenant.portfolio", { tenant: tenant.slug });
	const go = (change: Partial<PortfolioFilters>) =>
		router.get(
			portfolioHref(base, { ...filters, ...change }),
			{},
			{ preserveState: true, preserveScroll: true },
		);
	const here = portfolioHref(base, filters, page.current);

	const styleNames = useMemo(
		() =>
			Object.fromEntries(styleOptions.map(({ slug, name }) => [slug, name])),
		[styleOptions],
	);
	const everything = artists.reduce((sum, row) => sum + row.photoCount, 0);
	const filtered = isFiltered(filters);
	const canUpload = artists.some((row) => row.photoCount < maxPhotos);

	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [detailsOpen, setDetailsOpen] = useState(false);
	const [uploadOpen, setUploadOpen] = useState(false);
	const [uploading, setUploading] = useState(false);
	const galleryHeading = useRef<HTMLHeadingElement>(null);
	const selected = photos.find((photo) => photo.id === selectedId) ?? null;
	// The photo left the list (unpublished out of the filter, deleted): the
	// panel closes for good, so a later view that lists it again doesn't
	// open it by itself.
	if (detailsOpen && selectedId !== null && selected === null) {
		setDetailsOpen(false);
		setSelectedId(null);
	}

	// Selecting several photos (this page's only: a new page or filter keeps
	// the ones still listed).
	const [selecting, setSelecting] = useState(false);
	const [picked, setPicked] = useState<string[]>([]);
	const listed = useMemo(() => new Set(photos.map(({ id }) => id)), [photos]);
	const pickedHere = picked.filter((id) => listed.has(id));
	const toggle = (id: string) =>
		setPicked((current) =>
			current.includes(id)
				? current.filter((other) => other !== id)
				: [...current, id],
		);
	const stopSelecting = () => {
		setSelecting(false);
		setPicked([]);
	};

	const upload = (
		<Button
			size="sm"
			disabled={!canUpload}
			title={canUpload ? undefined : `Every artist has ${maxPhotos} photos`}
			onClick={() => setUploadOpen(true)}
		>
			<Upload aria-hidden="true" />
			Upload artwork
		</Button>
	);

	return (
		<Page
			title="Portfolio"
			description={PAGE_DESCRIPTION}
			actions={
				artists.length > 0 ? (
					<>
						<a
							href={storefront.galleryUrl}
							target="_blank"
							rel="noreferrer"
							className={buttonVariants({ variant: "outline", size: "sm" })}
						>
							<ExternalLink aria-hidden="true" />
							View your gallery
							<span className="sr-only"> (opens in a new tab)</span>
						</a>
						{upload}
					</>
				) : undefined
			}
		>
			{artists.length === 0 ? (
				<NoArtists isOwner={isOwner} tenantSlug={tenant.slug} />
			) : (
				<>
					<Toolbar
						base={base}
						filters={filters}
						artists={artists}
						styleOptions={styleOptions}
						go={go}
					/>

					<div className="flex flex-wrap items-baseline justify-between gap-2">
						<h2
							ref={galleryHeading}
							tabIndex={-1}
							className="text-sm font-medium outline-none"
						>
							{resultLine(page.total, everything, filtered)}
						</h2>
						<div className="flex flex-wrap items-center gap-x-4 gap-y-1">
							{filtered && (
								<Link
									href={portfolioHref(base, {
										...NO_FILTERS,
										sort: filters.sort,
									})}
									preserveScroll
									className="inline-flex items-center text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground max-lg:min-h-11"
								>
									Clear filters
								</Link>
							)}
							{photos.length > 0 && (
								<Button
									type="button"
									variant={selecting ? "secondary" : "outline"}
									size="sm"
									aria-pressed={selecting}
									onClick={() =>
										selecting ? stopSelecting() : setSelecting(true)
									}
								>
									{selecting ? (
										<>
											<Check aria-hidden="true" />
											Done selecting
										</>
									) : (
										<>
											<CheckSquare aria-hidden="true" />
											Select
										</>
									)}
								</Button>
							)}
						</div>
					</div>
					{storefront.devHost && (
						<p className="text-xs text-muted-foreground">
							Your page's address opens on this computer only until the studio
							site's address is set.
						</p>
					)}

					{photos.length === 0 ? (
						<p className="rounded-lg border border-dashed px-4 py-8 text-sm text-muted-foreground">
							{everything === 0
								? "No work yet. Upload photos of finished and healed tattoos; they show on your studio page while their artist is on it."
								: "No work matches these filters."}
						</p>
					) : (
						<ul
							aria-label="Work"
							className="grid grid-cols-2 gap-x-3 gap-y-5 max-[22rem]:grid-cols-1 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5"
						>
							{photos.map((photo, index) => (
								<Tile
									key={photo.id}
									// The first row is on screen at once: load it now, the rest lazily.
									eager={index < 4}
									photo={photo}
									styleNames={styleNames}
									selected={detailsOpen && photo.id === selectedId}
									picking={selecting}
									picked={pickedHere.includes(photo.id)}
									onOpen={() => {
										if (selecting) {
											toggle(photo.id);
											return;
										}
										setSelectedId(photo.id);
										setDetailsOpen(true);
									}}
								/>
							))}
						</ul>
					)}

					{page.last > 1 && (
						<nav
							aria-label="Pages"
							className="flex items-center justify-between gap-2 text-sm"
						>
							{page.current > 1 ? (
								<Link
									href={portfolioHref(base, filters, page.current - 1)}
									className={buttonVariants({ variant: "outline", size: "sm" })}
								>
									<ChevronLeft aria-hidden="true" />
									Previous
								</Link>
							) : (
								<span />
							)}
							<span className="text-muted-foreground tabular-nums">
								Page {page.current} of {page.last}
							</span>
							{page.current < page.last ? (
								<Link
									href={portfolioHref(base, filters, page.current + 1)}
									className={buttonVariants({ variant: "outline", size: "sm" })}
								>
									Next
									<ChevronRight aria-hidden="true" />
								</Link>
							) : (
								<span />
							)}
						</nav>
					)}

					{selecting && photos.length > 0 && (
						<PortfolioBulkBar
							tenantSlug={tenant.slug}
							selectedIds={pickedHere}
							photos={photos}
							artists={artists}
							isOwner={isOwner}
							back={here}
							held={uploading}
							onSelectAll={() => setPicked(photos.map(({ id }) => id))}
							onClear={() => setPicked([])}
							onDone={setPicked}
							fallback={galleryHeading}
						/>
					)}

					<ArtworkDetails
						photo={selected}
						open={detailsOpen && selected !== null}
						onOpenChange={setDetailsOpen}
						tenantSlug={tenant.slug}
						back={here}
						styleOptions={styleOptions}
						styleNames={styleNames}
						fallbackFocus={galleryHeading}
						held={uploading}
					/>
					<ArtworkUpload
						open={uploadOpen}
						onOpenChange={setUploadOpen}
						tenantSlug={tenant.slug}
						artists={artists}
						defaultArtistId={
							filters.artist ?? (artists.length === 1 ? artists[0].id : null)
						}
						styleOptions={styleOptions}
						maxPhotos={maxPhotos}
						backFor={(artistId) =>
							portfolioHref(base, { ...NO_FILTERS, artist: artistId })
						}
						onBusyChange={setUploading}
					/>
				</>
			)}
		</Page>
	);
}

PortfolioIndex.layout = [AppLayout];

/**
 * The search and the filters. The search is a GET form keeping the other
 * filters; each select applies on its own (FilterSelect). The artist filter
 * shows only when there is more than one artist.
 */
function Toolbar({
	base,
	filters,
	artists,
	styleOptions,
	go,
}: {
	base: string;
	filters: PortfolioFilters;
	artists: PortfolioPageProps["artists"];
	styleOptions: PortfolioPageProps["styleOptions"];
	go: (change: Partial<PortfolioFilters>) => void;
}) {
	return (
		<div className="flex flex-col gap-3 border-y py-3 lg:flex-row lg:items-center">
			<search className="min-w-0 lg:max-w-sm lg:flex-1">
				<form
					key={filters.search}
					method="get"
					action={base}
					className="flex gap-2"
					onSubmit={(event) => {
						event.preventDefault();
						const value = new FormData(event.currentTarget).get("q");
						go({ search: typeof value === "string" ? value.trim() : "" });
					}}
				>
					<div className="relative min-w-0 flex-1">
						<Search
							aria-hidden="true"
							className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
						/>
						<Input
							type="search"
							name="q"
							defaultValue={filters.search}
							placeholder="Description or artist"
							aria-label="Search work by description or artist"
							className="pl-9"
						/>
					</div>
					<Button type="submit" variant="outline">
						Search
					</Button>
				</form>
			</search>
			<div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap lg:ml-auto">
				{artists.length > 1 && (
					<FilterSelect
						id="portfolio-artist"
						label="Artist"
						value={filters.artist ?? ""}
						options={[
							{ value: "", label: "All artists" },
							...artists.map(({ id, name }) => ({ value: id, label: name })),
						]}
						onApply={(value) => go({ artist: value || null })}
					/>
				)}
				<FilterSelect
					id="portfolio-style"
					label="Style"
					value={filters.style ?? ""}
					options={[
						{ value: "", label: "All styles" },
						...styleOptions.map(({ slug, name }) => ({
							value: slug,
							label: name,
						})),
					]}
					onApply={(value) => go({ style: value || null })}
				/>
				<FilterSelect
					id="portfolio-healed"
					label="Healed"
					value={filters.healed ? "1" : ""}
					options={[
						{ value: "", label: "Fresh and healed" },
						{ value: "1", label: "Healed only" },
					]}
					onApply={(value) => go({ healed: value === "1" })}
				/>
				<FilterSelect
					id="portfolio-status"
					label="Status"
					value={filters.status}
					options={STATUS_OPTIONS}
					onApply={(value) =>
						go({ status: value as PortfolioFilters["status"] })
					}
				/>
				<FilterSelect
					id="portfolio-sort"
					label="Order"
					value={filters.sort}
					options={SORT_OPTIONS}
					onApply={(value) => go({ sort: value as PortfolioFilters["sort"] })}
				/>
			</div>
		</div>
	);
}

/**
 * One photo: its whole image at its own proportions in a 3:4 frame (nothing
 * is cropped), its artist, and its styles and healed mark. The tile is one
 * button that opens the details panel; a hidden photo carries a mark on the
 * image and says so in its name. A failed load shows a quiet placeholder.
 */
function Tile({
	photo,
	styleNames,
	selected,
	picking,
	picked,
	eager,
	onOpen,
}: {
	eager: boolean;
	photo: PortfolioPhoto;
	styleNames: Record<string, string>;
	selected: boolean;
	/** The page is selecting: a tap picks the photo instead of opening it. */
	picking: boolean;
	picked: boolean;
	onOpen: () => void;
}) {
	const [failed, setFailed] = useState(false);
	const meta = tileMeta(photo.styles, photo.healed, styleNames);
	return (
		<li className="min-w-0">
			<button
				id={`artwork-${photo.id}`}
				type="button"
				aria-haspopup={picking ? undefined : "dialog"}
				aria-pressed={picking ? picked : undefined}
				aria-label={picking ? `Select ${tileLabel(photo)}` : tileLabel(photo)}
				onClick={onOpen}
				className="group flex w-full flex-col gap-2 rounded-md text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
			>
				<span
					className={cn(
						"relative flex aspect-[3/4] w-full items-center justify-center overflow-hidden rounded-md bg-muted/60 ring-1 ring-border transition-shadow duration-150 group-hover:ring-foreground/30",
						(selected || picked) && "ring-2 ring-brand group-hover:ring-brand",
					)}
				>
					{failed ? (
						<span className="flex flex-col items-center gap-1.5 text-xs text-muted-foreground">
							<ImageOff aria-hidden="true" className="size-5" />
							Image unavailable
						</span>
					) : (
						<img
							src={photo.src}
							srcSet={photo.srcSet}
							sizes="(min-width: 1536px) 18vw, (min-width: 1024px) 22vw, (min-width: 640px) 30vw, 46vw"
							alt=""
							width={photo.width}
							height={photo.height}
							loading={eager ? "eager" : "lazy"}
							decoding="async"
							onError={() => setFailed(true)}
							className="size-full object-contain transition-opacity duration-150 group-hover:opacity-90 motion-reduce:transition-none"
						/>
					)}
					{!photo.shown && (
						<span className="absolute top-2 left-2 inline-flex items-center gap-1 rounded-sm bg-background/90 px-1.5 py-0.5 text-xs font-medium text-foreground">
							<EyeOff aria-hidden="true" className="size-3.5" />
							{statusText(photo)}
						</span>
					)}
					{picking && (
						<span
							aria-hidden="true"
							className={cn(
								"absolute top-2 right-2 flex size-6 items-center justify-center rounded-sm border-2 shadow-sm",
								picked
									? "border-brand bg-brand text-on-brand"
									: "border-foreground/40 bg-background/90",
							)}
						>
							{picked && <Check className="size-4" />}
						</span>
					)}
				</span>
				<span className="flex min-w-0 flex-col gap-0.5 px-0.5">
					<span className="truncate text-sm font-medium">
						{photo.artistName}
					</span>
					<span className="truncate text-xs text-muted-foreground">
						{meta ?? "No style tagged"}
					</span>
				</span>
			</button>
		</li>
	);
}

/** No artist the member may show work for: owners add one, an artist asks for their link. */
function NoArtists({
	isOwner,
	tenantSlug,
}: {
	isOwner: boolean;
	tenantSlug: string;
}) {
	return (
		<div className="flex flex-col items-start gap-3 rounded-lg border border-dashed px-5 py-8">
			<h2 className="text-base font-semibold">
				{isOwner ? "Add an artist first" : "No artist profile yet"}
			</h2>
			<p className="max-w-prose text-sm text-muted-foreground">
				{isOwner
					? "Every photo in your portfolio is an artist's work, shown on their page and in your studio's gallery. Add the artists who work here, then upload their work."
					: "Your login isn't linked to an artist profile yet, so there is no work to show. Ask the studio's owner to link you to your profile."}
			</p>
			{isOwner && (
				<Link
					href={urlFor("tenant.artists.create", { tenant: tenantSlug })}
					className={buttonVariants({ size: "sm" })}
				>
					<Plus aria-hidden="true" />
					Add an artist
				</Link>
			)}
		</div>
	);
}
