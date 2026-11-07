import { Link } from "@tanstack/react-router";
import type { DiscoverTattooSummary } from "@tattoo-drip/sdk";
import type { ReactNode } from "react";
import { ResponsiveImage } from "#/components/discovery/responsive-image";
import { FROM_GALLERY } from "#/lib/artwork";
import { tattooDestination, tattooProfile } from "#/lib/destinations";
import { tattooAlt } from "#/lib/home";
import { cn } from "#/lib/utils";

/*
 * A published photo as a tile (D09), everywhere photos appear: the
 * gallery, the homepage, style and location pages, profiles and an
 * artwork's related work. One primary link per tile, the image to its
 * artwork page; the artist's profile is a separate link in the caption,
 * never nested inside it.
 */

/** A photo's frame at its own proportions (a bad size falls back to 4 / 5). */
export function ratioOf(image: { width: number; height: number }): string {
	return image.width > 0 && image.height > 0
		? `${image.width} / ${image.height}`
		: "4 / 5";
}

/**
 * The caption's credit: the artist (to their profile), then the studio's
 * name or "Independent", then the first style, each optional.
 */
export function ArtworkCredit({
	tattoo,
	artist = true,
	studio = true,
	style = false,
}: {
	tattoo: DiscoverTattooSummary;
	artist?: boolean;
	studio?: boolean;
	style?: boolean;
}) {
	const profile = tattooProfile(tattoo);
	const first = tattoo.styles[0];
	const parts: { key: string; node: ReactNode }[] = [];
	if (artist)
		parts.push({
			key: "artist",
			node: profile ? (
				<Link
					to={profile}
					preload={false}
					className="py-1 font-medium text-current underline-offset-4 hover:underline"
				>
					{tattoo.artist.name}
				</Link>
			) : (
				tattoo.artist.name
			),
		});
	if (studio)
		parts.push({
			key: "studio",
			node:
				tattoo.studio.type === "independent"
					? "Independent"
					: tattoo.studio.name,
		});
	if (style && first) parts.push({ key: "style", node: first.name });
	return (
		<>
			{parts.map((part, index) => (
				<span key={part.key}>
					{index > 0 && " · "}
					{part.node}
				</span>
			))}
		</>
	);
}

/**
 * One photo: the image (true proportions in a fixed frame, so nothing
 * moves as it loads) linking to its artwork page, and its caption.
 */
export function ArtworkTile({
	tattoo,
	tone = "night",
	sizes = "(min-width: 64rem) 22vw, (min-width: 40rem) 33vw, 50vw",
	priority = false,
	eager = false,
	fromGallery = false,
	caption,
}: {
	tattoo: DiscoverTattooSummary;
	tone?: "night" | "paper";
	sizes?: string;
	priority?: boolean;
	eager?: boolean;
	/** The gallery's cards: the artwork page can then go back to that gallery (history). */
	fromGallery?: boolean;
	/** The caption; default the artist and studio. `null`: none. */
	caption?: ReactNode | null;
}) {
	return (
		<figure className="flex flex-col gap-2">
			<Link
				to={tattooDestination(tattoo)}
				preload={false}
				state={fromGallery ? (FROM_GALLERY as never) : undefined}
				className="group block"
			>
				<ResponsiveImage
					image={tattoo.image}
					alt={tattooAlt(tattoo)}
					ratio={ratioOf(tattoo.image)}
					sizes={sizes}
					priority={priority}
					eager={eager}
					className={tone === "night" ? "bg-night-raised" : undefined}
				/>
			</Link>
			{caption !== null && (
				<figcaption
					className={cn(
						"text-sm",
						tone === "night" ? "text-night-muted" : "text-muted-foreground",
					)}
				>
					{caption ?? <ArtworkCredit tattoo={tattoo} />}
				</figcaption>
			)}
		</figure>
	);
}

/**
 * Photos in CSS columns at their true proportions (2, 3, then 4 columns).
 * The first `eager` load at once (the first of them with high priority);
 * the rest lazily.
 */
export function ArtworkColumns({
	tattoos,
	tone = "night",
	sizes,
	eager = 0,
	fromGallery = false,
	caption,
	columns = "lg:columns-4",
	className,
}: {
	tattoos: readonly DiscoverTattooSummary[];
	tone?: "night" | "paper";
	sizes?: string;
	eager?: number;
	fromGallery?: boolean;
	caption?: (tattoo: DiscoverTattooSummary) => ReactNode;
	/** The widest layout's column count class. */
	columns?: string;
	className?: string;
}) {
	return (
		<ul
			className={cn(
				"columns-2 gap-3 sm:columns-3 sm:gap-4 lg:gap-6",
				columns,
				className,
			)}
		>
			{tattoos.map((tattoo, index) => (
				<li key={tattoo.id} className="mb-6 break-inside-avoid">
					<ArtworkTile
						tattoo={tattoo}
						tone={tone}
						sizes={sizes}
						priority={eager > 0 && index === 0}
						eager={index < eager}
						fromGallery={fromGallery}
						caption={caption?.(tattoo)}
					/>
				</li>
			))}
		</ul>
	);
}
