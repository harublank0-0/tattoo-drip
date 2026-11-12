import atelier from "~/assets/themes/atelier.webp";
import inkNoir from "~/assets/themes/ink-noir.webp";
import irezumi from "~/assets/themes/irezumi.webp";
import stencilAndInk from "~/assets/themes/stencil-and-ink.webp";

/**
 * Page look's theme samples: each theme's home page on a demo studio, on a
 * laptop with a phone in the corner (inertia/assets/themes/, 960 x 600 WebP,
 * 20 to 50 KB each: Irezumi's paper texture is the largest). The demo's photos are placeholder ink-wash art, not a
 * studio's work. A theme without a sample here shows its card without one;
 * tests/unit/inertia/page_look_source.spec.ts fails until every theme the
 * server lists has one. Re-shoot a sample when its theme's home page changes
 * (apps/platform/docs/ui.md, Page look).
 */
const SAMPLES: Record<string, string> = {
	"stencil-and-ink": stencilAndInk,
	"ink-noir": inkNoir,
	irezumi,
	atelier,
};

/**
 * A theme's sample, or nothing for a theme without one. Decoration beside the
 * theme's name and description, which say the same in words (`alt=""`); lazy,
 * with its own size, so the cards don't move as it loads.
 */
export function ThemeSample({ theme }: { theme: string }) {
	const src = Object.hasOwn(SAMPLES, theme) ? SAMPLES[theme] : undefined;
	if (!src) return null;
	return (
		<img
			src={src}
			alt=""
			width={960}
			height={600}
			loading="lazy"
			decoding="async"
			className="aspect-[8/5] h-auto w-full rounded-md border object-cover"
		/>
	);
}
