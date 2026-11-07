import { ImageOffIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "#/lib/utils";

/** An image as the Discover API sends it (`ShownImage`): its URL, size and smaller copies. */
export type ImageSource = {
	url: string;
	width: number;
	height: number;
	variants?: { url: string; width: number }[];
};

/**
 * The widest copy a thumbnail may load (D10): a tile, card or strip never
 * needs more than the API's 1280 px copy (a 640 px wide slot at 2x), so the
 * stored original (up to 2048 px) stays for the pages that show the photo
 * large (the artwork page, a profile's hero) and for "View full size".
 */
export const THUMBNAIL_MAX_WIDTH = 1280;

/**
 * The `srcset` candidates of an API image, narrowest first: its copies and
 * the original at its own width. With `maxWidth`, candidates wider than it
 * are left out, unless that would leave none (an image stored before the
 * copies existed has only its original). Only the API's own URLs.
 */
export function imageCandidates(
	image: ImageSource,
	maxWidth?: number,
): { url: string; width: number }[] {
	const all = [
		...(image.variants ?? []),
		{ url: image.url, width: image.width },
	];
	if (maxWidth === undefined) return all;
	const fitting = all.filter((candidate) => candidate.width <= maxWidth);
	return fitting.length > 0 ? fitting : all.slice(0, 1);
}

/** `src` and `srcSet` for an `<img>`: `src` is the widest candidate kept. */
export function imageSources(
	image: ImageSource,
	maxWidth?: number,
): { src: string; srcSet: string } {
	const candidates = imageCandidates(image, maxWidth);
	return {
		src: (candidates[candidates.length - 1] ?? image).url,
		srcSet: candidates.map((each) => `${each.url} ${each.width}w`).join(", "),
	};
}

/**
 * A small fixed-size picture (a logo or portrait badge, 48 to 112 px): the
 * smallest copy that covers `size` CSS px at the screen's density, never
 * the original when a copy exists.
 */
export function BadgeImage({
	image,
	size,
	className,
	lazy = false,
}: {
	image: ImageSource;
	/** The largest size it is shown at, in CSS px. */
	size: number;
	className?: string;
	lazy?: boolean;
}) {
	const { src, srcSet } = imageSources(image, THUMBNAIL_MAX_WIDTH);
	return (
		<img
			src={src}
			srcSet={srcSet}
			sizes={`${size}px`}
			width={image.width}
			height={image.height}
			alt=""
			loading={lazy ? "lazy" : undefined}
			decoding="async"
			className={className}
		/>
	);
}

/**
 * A public photo in a fixed frame: the frame keeps its aspect ratio before
 * the file loads (no layout shift), the browser picks a copy from `srcset`,
 * and a missing or broken image shows a quiet placeholder instead of a
 * broken icon. Only URLs from the API: never a stock or private image.
 */
export function ResponsiveImage({
	image,
	alt,
	ratio = "4 / 5",
	sizes = "(min-width: 64rem) 33vw, (min-width: 40rem) 50vw, 100vw",
	priority = false,
	eager = false,
	large = false,
	fit = "cover",
	className,
}: {
	image: ImageSource | null;
	/** What the image shows; "" only when it is decorative. */
	alt: string;
	/** The frame's aspect ratio; null when `className` sets it (e.g. per breakpoint). */
	ratio?: string | null;
	sizes?: string;
	/** Above the fold: load at once instead of lazily, with high priority (the page's lead image). */
	priority?: boolean;
	/** Load at once, at normal priority (the rest of a gallery's first row, D09). */
	eager?: boolean;
	/**
	 * Shown large (the artwork page, a profile's hero): the original may be
	 * picked. Otherwise a thumbnail: copies up to THUMBNAIL_MAX_WIDTH only.
	 */
	large?: boolean;
	fit?: "cover" | "contain";
	className?: string;
}) {
	const [failed, setFailed] = useState(false);
	const ref = useRef<HTMLImageElement>(null);
	// A server-rendered image can fail before hydration, when React isn't
	// listening for its error yet (D10): check once on mount.
	useEffect(() => {
		const img = ref.current;
		if (img?.complete && img.naturalWidth === 0) setFailed(true);
	}, []);
	const sources = image
		? imageSources(image, large ? undefined : THUMBNAIL_MAX_WIDTH)
		: undefined;
	return (
		<div
			className={cn("relative overflow-hidden bg-paper-sunk", className)}
			style={ratio ? { aspectRatio: ratio } : undefined}
		>
			{image && !failed ? (
				<img
					ref={ref}
					src={sources?.src}
					srcSet={sources?.srcSet}
					sizes={sizes}
					width={image.width}
					height={image.height}
					alt={alt}
					loading={priority || eager ? "eager" : "lazy"}
					decoding="async"
					fetchPriority={priority ? "high" : undefined}
					onError={() => setFailed(true)}
					className={cn(
						"size-full transition-transform duration-500 motion-safe:group-hover:scale-[1.02]",
						fit === "cover" ? "object-cover" : "object-contain",
					)}
				/>
			) : (
				<div
					role="img"
					aria-label={alt ? `${alt} (image unavailable)` : "Image unavailable"}
					className="flex size-full items-center justify-center text-ink-muted"
				>
					<ImageOffIcon className="size-6" aria-hidden="true" />
				</div>
			)}
		</div>
	);
}
