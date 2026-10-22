import type { BrandImage } from "../theme/config.ts";

/**
 * A studio's logo and cover image (TAT-54), from parseThemeConfig's checked
 * values only. Both are decoration beside the studio's name, so their alt
 * text is empty; width and height are always set, so nothing shifts while
 * they load. Never a CSS url(): a URL inside CSS would need CSS escaping and
 * could carry no size or alt text. The logo is small and has the page's text
 * beside it: `fetchPriority="low"` also stops React from adding a
 * `<link rel="preload">` for it, which would compete with the cover and the font.
 */
export function BrandLogo({
	image,
	className,
}: {
	image: BrandImage;
	className: string;
}) {
	return (
		<img
			className={className}
			src={image.src}
			width={image.width}
			height={image.height}
			alt=""
			decoding="async"
			fetchPriority="low"
		/>
	);
}

/** The cover above the hero: the page's first image, so it loads first. */
export function BrandCover({ image }: { image: BrandImage }) {
	return (
		<div className="profile-cover">
			<img
				src={image.src}
				width={image.width}
				height={image.height}
				alt=""
				loading="eager"
				decoding="async"
				fetchPriority="high"
			/>
		</div>
	);
}
