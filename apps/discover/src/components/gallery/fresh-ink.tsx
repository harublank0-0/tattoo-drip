import { Link } from "@tanstack/react-router";
import type { DiscoverFreshInkPost } from "@tattoo-drip/sdk";
import { ArrowUpRightIcon, PlayIcon, XIcon } from "lucide-react";
import { Dialog } from "radix-ui";
import type { ReactNode } from "react";
import { ResponsiveImage } from "#/components/discovery/responsive-image";
import { buttonVariants } from "#/components/ui/button";
import { bookingLinks } from "#/lib/booking";
import { profileDestination, tattooProfile } from "#/lib/destinations";
import { dayText, freshInkAlt, mediaCount, videoLabel } from "#/lib/reviews";
import { paths } from "#/lib/routes";
import { cn } from "#/lib/utils";
import { ratioOf } from "./artwork-tile.tsx";

/*
 * Fresh ink on Discover (Reviews and Fresh ink, slice 4): a client's
 * healed tattoo as a tile, in columns at true proportions like every photo
 * tile (ArtworkTile), and its viewer. A post has no page of its own: its
 * tile opens a modal viewer (Radix Dialog, like the menu and filter sheets:
 * focus moves in and is trapped, Escape and Close return it to the tile)
 * that shows every photo and ready video in the client's order, the way an
 * artwork page shows its photo, with what the post says and the booking
 * hand-off. Videos are never autoplayed and have no sound. The client's
 * words (caption, placement, shown name) are plain text, `dir="auto"` and
 * in `<bdi>`, so a right-to-left name never reorders the line around it.
 */

/** The profile a post's studio links to: the studio's, or an independent artist's own. */
export function freshInkStudioPath(post: DiscoverFreshInkPost): string {
	return post.studio.type === "independent"
		? paths.independentArtist(post.studio.slug)
		: profileDestination({
				slug: post.studio.slug,
				storefrontUrl: post.storefrontUrl,
			}).href;
}

/** The caption's credit on the feed: the artist (their profile), then the studio (its profile). */
export function FreshInkCredit({ post }: { post: DiscoverFreshInkPost }) {
	const artist = tattooProfile(post);
	return (
		<>
			{artist ? (
				<Link
					to={artist}
					preload={false}
					className="py-1 font-medium text-current underline-offset-4 hover:underline"
				>
					<bdi>{post.artist.name}</bdi>
				</Link>
			) : (
				<bdi>{post.artist.name}</bdi>
			)}
			{post.studio.type === "studio" && (
				<>
					{" · "}
					<Link
						to={freshInkStudioPath(post)}
						preload={false}
						className="py-1 text-current underline-offset-4 hover:underline"
					>
						<bdi>{post.studio.name}</bdi>
					</Link>
				</>
			)}
		</>
	);
}

/**
 * One post: its lead photo as the button that opens the viewer (its name
 * says how many photos and videos it holds), and a caption.
 */
export function FreshInkTile({
	post,
	tone = "night",
	sizes = "(min-width: 64rem) 22vw, (min-width: 40rem) 33vw, 50vw",
	priority = false,
	eager = false,
	caption,
}: {
	post: DiscoverFreshInkPost;
	tone?: "night" | "paper";
	sizes?: string;
	priority?: boolean;
	eager?: boolean;
	caption?: ReactNode;
}) {
	const count = mediaCount(post);
	return (
		<figure className="flex flex-col gap-2">
			<Dialog.Root>
				<Dialog.Trigger asChild>
					<button
						type="button"
						className="group relative block w-full cursor-zoom-in text-left"
					>
						<ResponsiveImage
							image={post}
							alt={freshInkAlt(post)}
							ratio={ratioOf(post)}
							sizes={sizes}
							priority={priority}
							eager={eager}
							className={tone === "night" ? "bg-night-raised" : undefined}
						/>
						{count && (
							<span className="absolute right-2 bottom-2 inline-flex items-center gap-1 rounded-[2px] bg-ink/80 px-2 py-1 text-xs font-medium text-night-ink">
								{post.angles.some((angle) => angle.kind === "video") && (
									<PlayIcon className="size-3" aria-hidden="true" />
								)}
								{count}
							</span>
						)}
						<span className="sr-only">{`, open Fresh ink by ${post.shownName}`}</span>
					</button>
				</Dialog.Trigger>
				<FreshInkViewer post={post} />
			</Dialog.Root>
			<figcaption
				className={cn(
					"text-sm",
					tone === "night" ? "text-night-muted" : "text-muted-foreground",
				)}
			>
				{caption ?? <FreshInkCredit post={post} />}
			</figcaption>
		</figure>
	);
}

/** Posts in CSS columns at their true proportions, as ArtworkColumns. */
export function FreshInkColumns({
	posts,
	tone = "night",
	sizes,
	eager = 0,
	caption,
	columns = "lg:columns-4",
}: {
	posts: readonly DiscoverFreshInkPost[];
	tone?: "night" | "paper";
	sizes?: string;
	eager?: number;
	caption?: (post: DiscoverFreshInkPost) => ReactNode;
	columns?: string;
}) {
	return (
		<ul
			className={cn("columns-2 gap-3 sm:columns-3 sm:gap-4 lg:gap-6", columns)}
		>
			{posts.map((post, index) => (
				<li key={post.id} className="mb-6 break-inside-avoid">
					<FreshInkTile
						post={post}
						tone={tone}
						sizes={sizes}
						priority={eager > 0 && index === 0}
						eager={index < eager}
						caption={caption?.(post)}
					/>
				</li>
			))}
		</ul>
	);
}

/**
 * The viewer: every photo and ready video of the post, in order, at its own
 * proportions (lazy until opened: the dialog's content mounts on open),
 * then what the post says, who made it and the booking hand-off.
 */
export function FreshInkViewer({ post }: { post: DiscoverFreshInkPost }) {
	const total = post.angles.length + 1;
	const { request, site } = bookingLinks(post, post.artist.slug);
	const artist = tattooProfile(post);
	return (
		<Dialog.Portal>
			<Dialog.Overlay className="fixed inset-0 z-50 bg-ink/70" />
			<Dialog.Content className="fixed inset-x-0 top-0 bottom-0 z-50 mx-auto flex w-full max-w-4xl flex-col overflow-y-auto bg-paper shadow-lg focus:outline-hidden sm:inset-y-6 sm:w-[calc(100%-3rem)]">
				<div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-line bg-paper px-4 py-2 sm:px-6">
					<Dialog.Title className="min-w-0 truncate font-display text-xl font-bold">
						Fresh ink by <bdi>{post.shownName}</bdi>
					</Dialog.Title>
					<Dialog.Close
						className={buttonVariants({ variant: "ghost", size: "md" })}
					>
						<XIcon aria-hidden="true" />
						Close
					</Dialog.Close>
				</div>
				<Dialog.Description className="sr-only">
					{`A healed tattoo by ${post.artist.name}, posted by a client of ${post.studio.name}: ${total === 1 ? "one photo" : `${total} photos and videos`}.`}
				</Dialog.Description>
				<div className="flex flex-col gap-4 p-4 sm:p-6">
					<ResponsiveImage
						image={post}
						alt={freshInkAlt(post, { index: 0, total })}
						ratio={ratioOf(post)}
						large
						eager
						sizes="(min-width: 56rem) 52rem, 100vw"
						className="mx-auto max-h-[80vh] w-auto max-w-full"
					/>
					{post.angles.map((angle, index) =>
						angle.kind === "photo" ? (
							<ResponsiveImage
								// biome-ignore lint/suspicious/noArrayIndexKey: the post's fixed order.
								key={`photo-${index}`}
								image={angle}
								alt={freshInkAlt(
									{ alt: angle.alt, artist: post.artist },
									{ index: index + 1, total },
								)}
								ratio={ratioOf(angle)}
								large
								sizes="(min-width: 56rem) 52rem, 100vw"
								className="mx-auto max-h-[80vh] w-auto max-w-full"
							/>
						) : angle.kind === "video" ? (
							<video
								// biome-ignore lint/suspicious/noArrayIndexKey: the post's fixed order.
								key={`video-${index}`}
								controls
								muted
								playsInline
								preload="none"
								poster={angle.poster.url}
								width={angle.poster.width}
								height={angle.poster.height}
								aria-label={angle.alt?.trim() || videoLabel(angle.durationMs)}
								className="mx-auto max-h-[80vh] w-auto max-w-full bg-night"
								style={{ aspectRatio: ratioOf(angle.poster) }}
							>
								{angle.sources.map((source) => (
									<source
										key={source.url}
										src={source.url}
										type={source.type}
									/>
								))}
							</video>
						) : null,
					)}
					<div className="flex flex-col gap-3 border-t border-line pt-4">
						{post.caption && (
							<p className="text-lg whitespace-pre-line" dir="auto">
								{post.caption}
							</p>
						)}
						<p className="text-sm text-muted-foreground">
							<bdi>{post.shownName}</bdi>
							{" · "}
							<time dateTime={post.date}>{dayText(post.date)}</time>
						</p>
						<p>
							{"Tattoo by "}
							{artist ? (
								<Link
									to={artist}
									className="font-medium underline underline-offset-4"
								>
									<bdi>{post.artist.name}</bdi>
								</Link>
							) : (
								<bdi>{post.artist.name}</bdi>
							)}
							{post.studio.type === "studio" && (
								<>
									{" at "}
									<Link
										to={freshInkStudioPath(post)}
										className="font-medium underline underline-offset-4"
									>
										<bdi>{post.studio.name}</bdi>
									</Link>
								</>
							)}
						</p>
						{post.styles.length > 0 && (
							<p className="text-sm">
								{post.styles.map((style) => style.name).join(" · ")}
							</p>
						)}
						{post.placement && (
							<p className="text-sm" dir="auto">
								<span className="sr-only">Placement: </span>
								{post.placement}
							</p>
						)}
						{(request || site) && (
							<div className="flex flex-wrap gap-3 pt-2">
								{request && (
									<a
										href={request}
										className={buttonVariants({ variant: "accent" })}
									>
										{`Request with ${post.artist.name}`}
										<ArrowUpRightIcon aria-hidden="true" />
										<span className="sr-only">{`(${post.studio.name}'s own booking form)`}</span>
									</a>
								)}
								{site && (
									<a
										href={site}
										className={buttonVariants({ variant: "outline" })}
									>
										Visit studio site
										<ArrowUpRightIcon aria-hidden="true" />
										<span className="sr-only">{`(${post.studio.name}'s own site)`}</span>
									</a>
								)}
							</div>
						)}
						<p className="text-sm text-muted-foreground">
							Posted by a client of the studio through the studio's own review
							link, and shown with their permission.
						</p>
					</div>
				</div>
			</Dialog.Content>
		</Dialog.Portal>
	);
}
