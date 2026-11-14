import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";
import { TattooDialog } from "../angles.tsx";
import { studioCopy } from "../copy.ts";
import {
	type FreshInkPostView,
	type FreshInkView,
	HOME_FRESH_INK_COUNT,
} from "../fresh-ink.ts";
import { showPhoto } from "../lightbox.ts";
import { freshInkHref, isAllowedHref } from "../links.ts";
import { workGridSizes } from "../srcset.ts";

/**
 * Fresh ink on the studio's own page (Reviews and Fresh ink, slice 3): the
 * viewer every theme opens a post in, what it says about the post, and
 * Stencil & Ink's section. A post opens in the same `<dialog>` as a gallery
 * tattoo: one of a single photo is the plain viewer, one with angles the
 * TattooDialog island (angles.tsx: Previous and Next, the arrow keys, a
 * swipe, its videos never autoplayed). Props only and no state here. The
 * client's caption and placement are plain text, never markup.
 */

/** "Tattoo by " before the artist's link: the name itself is the link. */
const TATTOO_BY = studioCopy.freshInk.tattooBy.replace("{artist}", "");

/**
 * What a post is, under its photo in the viewer: the client's caption, who
 * shows it, the artist who made it (a link, while the studio shows them),
 * its styles, where it is and the month it was published.
 */
export function FreshInkFacts({ post }: { post: FreshInkPostView }) {
	const artist =
		post.artist && isAllowedHref(post.artist.href) ? post.artist : null;
	return (
		<div className="work-dialog-meta fresh-ink-facts">
			{post.postCaption ? (
				<p className="fresh-ink-caption user-text" dir="auto">
					{post.postCaption}
				</p>
			) : null}
			<p>
				<bdi>{post.shownBy}</bdi>
				{post.date ? (
					<>
						<span aria-hidden="true"> · </span>
						<time dateTime={post.date.dateTime}>{post.date.text}</time>
					</>
				) : null}
			</p>
			{artist ? (
				<p>
					{TATTOO_BY}
					<a className="text-link" href={artist.href}>
						<bdi>{artist.name}</bdi>
					</a>
				</p>
			) : null}
			{post.styles.length > 0 ? <p>{post.styles.join(" · ")}</p> : null}
			{post.placement ? (
				<p dir="auto">
					<span className="sr-only">{studioCopy.freshInk.placement}: </span>
					{post.placement}
				</p>
			) : null}
		</div>
	);
}

/**
 * A post's viewer, opened by `showPhoto(post.dialogId)`: the plain viewer for
 * one photo (its Close form, "Photo n", the large copy, lazy until opened),
 * the stepping one (TattooDialog) for a post with angles.
 */
export function FreshInkDialog({ post }: { post: FreshInkPostView }) {
	if (post.angles.length > 0) {
		return <TattooDialog photo={post} facts={<FreshInkFacts post={post} />} />;
	}
	return (
		<dialog id={post.dialogId} className="work-dialog" aria-label={post.alt}>
			<form method="dialog" className="work-dialog-bar">
				<p>{post.label}</p>
				<button type="submit" className="action action-secondary">
					{studioCopy.work.close}
				</button>
			</form>
			<img
				className="work-large"
				src={post.largeSrc}
				width={post.width}
				height={post.height}
				alt={post.alt}
				loading="lazy"
				decoding="async"
			/>
			{post.caption ? (
				<p className="work-dialog-caption user-text" dir="auto">
					{post.caption}
				</p>
			) : null}
			<FreshInkFacts post={post} />
		</dialog>
	);
}

/**
 * The button that opens a post's viewer, around whatever the theme draws
 * (its photo, its mark): `aria-haspopup`, the dialog it controls and the
 * `openId` that "Show more" may move focus to.
 */
export function FreshInkOpen({
	post,
	className,
	children,
}: {
	post: FreshInkPostView;
	className: string;
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			className={className}
			id={post.openId}
			aria-haspopup="dialog"
			aria-controls={post.dialogId}
			onClick={() => showPhoto(post.dialogId)}
		>
			{children}
		</button>
	);
}

/** "All Fresh ink", to `/fresh-ink`: only when more follow than the section shows. */
export function AllFreshInkLink({
	view,
	className = "text-link",
}: {
	view: FreshInkView;
	className?: string;
}) {
	if (view.nextCursor === null) return null;
	return (
		<a className={className} href={freshInkHref({})}>
			<span>{studioCopy.freshInk.all}</span>
			<ArrowRight aria-hidden="true" />
		</a>
	);
}

/**
 * Posts in Stencil & Ink's square grid (the gallery's `work-grid`), each a
 * button that opens its viewer; a post of several photos says so on its
 * button ("3 photos and videos"), a visible part of its name.
 */
export function FreshInkGrid({
	posts,
}: {
	posts: readonly FreshInkPostView[];
}) {
	if (posts.length === 0) return null;
	return (
		// biome-ignore lint/a11y/useSemanticElements: it is a <ul>; the role repairs WebKit's reading of list-style: none
		// biome-ignore lint/a11y/noRedundantRoles: redundant for the spec, needed for WebKit with list-style: none
		<ul className="work-grid fresh-ink-grid" role="list">
			{posts.map((post) => (
				<li key={post.dialogId}>
					<FreshInkOpen post={post} className="work-open">
						<img
							className="work-photo"
							src={post.src}
							srcSet={post.srcSet}
							sizes={post.srcSet ? workGridSizes(post) : undefined}
							width={post.width}
							height={post.height}
							alt={post.alt}
							loading="lazy"
							decoding="async"
						/>
						{post.photosLabel ? (
							<span className="work-count">{post.photosLabel}</span>
						) : null}
					</FreshInkOpen>
					<FreshInkDialog post={post} />
				</li>
			))}
		</ul>
	);
}

/**
 * Stencil & Ink's Fresh ink section (the `fresh_ink` key): a line on what it
 * is, the newest six posts, and "All Fresh ink" when more follow. Nothing
 * when there are none: no empty heading.
 */
export function FreshInkSection({ view }: { view: FreshInkView }) {
	const posts = view.posts.slice(0, HOME_FRESH_INK_COUNT);
	if (posts.length === 0) return null;
	return (
		<section
			id="fresh-ink"
			className="section"
			aria-labelledby="fresh-ink-title"
		>
			<h2 id="fresh-ink-title" className="section-title">
				{studioCopy.freshInk.title}
			</h2>
			<p className="fresh-ink-intro measure">{studioCopy.freshInk.intro}</p>
			<FreshInkGrid posts={posts} />
			{view.nextCursor !== null ? (
				<p className="work-all">
					<AllFreshInkLink view={view} />
				</p>
			) : null}
		</section>
	);
}
