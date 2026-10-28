import { coverSizes } from "../srcset.ts";
import type { BrandImage, CoverImage } from "../theme/config.ts";

/**
 * A studio's logo and cover image (TAT-54), from parseThemeConfig's checked
 * values only. The logo is decoration beside the studio's name, so its alt
 * text is empty; the cover is a photograph and says what it shows when the
 * API gave a description (else its alt is empty too). Width and height are
 * always set, so nothing shifts while they load. Never a CSS url(): a URL
 * inside CSS would need CSS escaping and could carry no size or alt text.
 *
 * With smaller copies (TAT-112) both carry `srcset` and the slot's `sizes`.
 *
 * The logo is small and has the studio's name beside it, so it has
 * `fetchPriority="low"`: that also stops React from adding a
 * `<link rel="preload">` for it, which would compete with the cover and the
 * font.
 */
export function BrandLogo({
	image,
	className,
	sizes,
}: {
	image: BrandImage;
	className: string;
	/** The width this logo is drawn at (logoSizes, srcset.ts). */
	sizes: string;
}) {
	return (
		<img
			className={className}
			src={image.src}
			srcSet={image.srcSet}
			sizes={image.srcSet ? sizes : undefined}
			width={image.width}
			height={image.height}
			alt=""
			decoding="async"
			fetchPriority="low"
		/>
	);
}

/** The cover above the hero: the page's first image, so it loads first. */
export function BrandCover({ image }: { image: CoverImage }) {
	return (
		<div className="profile-cover">
			<img
				src={image.src}
				srcSet={image.srcSet}
				sizes={image.srcSet ? coverSizes(image) : undefined}
				width={image.width}
				height={image.height}
				alt={image.alt}
				loading="eager"
				decoding="async"
				fetchPriority="high"
			/>
		</div>
	);
}
