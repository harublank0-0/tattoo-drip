import { studioCopy } from "../copy.ts";
import type { GalleryPhotoView, GalleryView, WorkSearch } from "../gallery.ts";
import { showPhoto } from "../lightbox.ts";
import { isAllowedHref } from "../links.ts";
import { workGridSizes } from "../srcset.ts";

/**
 * The gallery's pieces (TAT-126): the photo grid with its viewer, the artist
 * page's All / Healed links and the All work page's filter form. Props only
 * and no state: the one stateful piece, "Show more", is src/studio/paging.tsx.
 */

/**
 * Photos in a square grid, each a button that opens that photo's own
 * `<dialog>` (the browser's modal: Escape, focus and the inert page behind are
 * its own; showPhoto is the one DOM call). The dialog holds a Close form
 * (`method="dialog"`), the photo's label, the large copy (lazy: inside a
 * closed dialog it is not fetched until opened), the description, and what the
 * photo is: whose (a link to their page, only where `showArtist`: an artist's
 * own page does not link to itself), its styles and whether it has healed.
 * Nothing when there are no photos.
 */
export function GalleryGrid({
	photos,
	showArtist,
}: {
	photos: readonly GalleryPhotoView[];
	showArtist: boolean;
}) {
	if (photos.length === 0) return null;
	return (
		// biome-ignore lint/a11y/useSemanticElements: it is a <ul>; the role repairs WebKit's reading of list-style: none
		// biome-ignore lint/a11y/noRedundantRoles: redundant for the spec, needed for WebKit with list-style: none
		<ul className="work-grid" role="list">
			{photos.map((photo) => (
				<li key={photo.dialogId}>
					<button
						type="button"
						className="work-open"
						id={photo.openId}
						aria-haspopup="dialog"
						aria-controls={photo.dialogId}
						onClick={() => showPhoto(photo.dialogId)}
					>
						<img
							className="work-photo"
							src={photo.src}
							srcSet={photo.srcSet}
							sizes={photo.srcSet ? workGridSizes(photo) : undefined}
							width={photo.width}
							height={photo.height}
							alt={photo.alt}
							loading="lazy"
							decoding="async"
						/>
					</button>
					<dialog
						id={photo.dialogId}
						className="work-dialog"
						aria-label={photo.label}
					>
						<form method="dialog" className="work-dialog-bar">
							<p>{photo.label}</p>
							<button type="submit" className="action action-secondary">
								{studioCopy.work.close}
							</button>
						</form>
						<img
							className="work-large"
							src={photo.largeSrc}
							width={photo.width}
							height={photo.height}
							alt={photo.alt}
							loading="lazy"
							decoding="async"
						/>
						{photo.caption ? (
							<p className="work-dialog-caption user-text" dir="auto">
								{photo.caption}
							</p>
						) : null}
						<PhotoFacts photo={photo} showArtist={showArtist} />
					</dialog>
				</li>
			))}
		</ul>
	);
}

/** Whose photo it is, its styles and the healed mark, under the caption; nothing when there is none of them. */
function PhotoFacts({
	photo,
	showArtist,
}: {
	photo: GalleryPhotoView;
	showArtist: boolean;
}) {
	const artist =
		showArtist && photo.artist && isAllowedHref(photo.artist.href)
			? photo.artist
			: null;
	if (!artist && photo.styles.length === 0 && !photo.healed) return null;
	return (
		<div className="work-dialog-meta">
			{artist ? (
				<p>
					<a className="text-link" href={artist.href}>
						<bdi>{artist.name}</bdi>
					</a>
				</p>
			) : null}
			{photo.styles.length > 0 ? <p>{photo.styles.join(" · ")}</p> : null}
			{photo.healed ? <p>{studioCopy.work.healed}</p> : null}
		</div>
	);
}

/** The artist page's two links, All and Healed; `healed` says which one is showing. */
export function HealedFilter({
	allHref,
	healedHref,
	healed,
}: {
	allHref: string;
	healedHref: string;
	healed: boolean;
}) {
	return (
		<nav className="work-filter-nav" aria-label={studioCopy.work.filterNav}>
			<a href={allHref} aria-current={healed ? undefined : "page"}>
				{studioCopy.work.all}
			</a>
			<a href={healedHref} aria-current={healed ? "page" : undefined}>
				{studioCopy.work.healed}
			</a>
		</nav>
	);
}

/**
 * The All work page's filters: a plain GET form to `/work`, so it works
 * without JavaScript and every filtered view is an address that can be
 * shared. It offers only what applies: the artists when there is more than
 * one with photos, the styles some photo carries, and Healed when a photo has
 * healed (or the address asked for it, so it can be unticked). Each control
 * starts where the address is. Nothing at all when none applies.
 */
export function WorkFilters({
	artists,
	gallery,
	search,
}: {
	artists: readonly { readonly slug: string; readonly name: string }[];
	gallery: GalleryView;
	search: WorkSearch;
}) {
	const words = studioCopy.work.filters;
	const showArtists = artists.length > 1;
	const showStyles = gallery.styles.length > 0;
	const showHealed = gallery.healed || search.healed === true;
	if (!showArtists && !showStyles && !showHealed) return null;
	return (
		// biome-ignore lint/a11y/useSemanticElements: a form with the search role is the pattern; <search> is not supported by the browsers we serve
		<form
			className="work-filters"
			role="search"
			aria-label={words.label}
			method="get"
			action="/work"
		>
			{showArtists ? (
				<div className="work-filter-field">
					<label htmlFor="work-artist">{words.artist}</label>
					<select
						id="work-artist"
						name="artist"
						defaultValue={search.artist ?? ""}
					>
						<option value="">{words.anyArtist}</option>
						{artists.map((artist) => (
							<option key={artist.slug} value={artist.slug}>
								{artist.name}
							</option>
						))}
					</select>
				</div>
			) : null}
			{showStyles ? (
				<div className="work-filter-field">
					<label htmlFor="work-style">{words.style}</label>
					<select
						id="work-style"
						name="style"
						defaultValue={search.style ?? ""}
					>
						<option value="">{words.anyStyle}</option>
						{gallery.styles.map((style) => (
							<option key={style.slug} value={style.slug}>
								{style.name}
							</option>
						))}
					</select>
				</div>
			) : null}
			{showHealed ? (
				<label className="work-filter-check">
					<input
						type="checkbox"
						name="healed"
						value="1"
						defaultChecked={search.healed === true}
					/>
					<span>{words.healedOnly}</span>
				</label>
			) : null}
			<button type="submit" className="action action-secondary">
				{words.apply}
			</button>
		</form>
	);
}
