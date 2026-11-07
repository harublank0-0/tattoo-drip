import { ImageOffIcon } from "lucide-react";
import { useState } from "react";
import { cn } from "#/lib/utils";

/** An image as the Discover API sends it (`ShownImage`): its URL, size and smaller copies. */
export type ImageSource = {
	url: string;
	width: number;
	height: number;
	variants?: { url: string; width: number }[];
};

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
	fit?: "cover" | "contain";
	className?: string;
}) {
	const [failed, setFailed] = useState(false);
	const srcSet = image
		? [
				...(image.variants ?? []).map((v) => `${v.url} ${v.width}w`),
				`${image.url} ${image.width}w`,
			].join(", ")
		: undefined;
	return (
		<div
			className={cn("relative overflow-hidden bg-paper-sunk", className)}
			style={ratio ? { aspectRatio: ratio } : undefined}
		>
			{image && !failed ? (
				<img
					src={image.url}
					srcSet={srcSet}
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
