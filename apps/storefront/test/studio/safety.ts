import assert from "node:assert/strict";
import { isAllowedHref } from "../../src/studio/links.ts";

export interface SafePageOptions {
	/**
	 * A studio's logo and cover (TAT-54) are decoration beside its name: the
	 * logo (class `profile-logo` or `site-bar-logo`) must have `alt=""`, and
	 * the cover (the `<img>` inside `profile-cover`, or inside Ink Noir's
	 * `ink-hero-media`) may have an empty alt.
	 * Every other image still needs its alt text.
	 */
	brandImages?: boolean;
}

const count = (html: string, pattern: RegExp) =>
	html.match(pattern)?.length ?? 0;
const decodeAttribute = (value: string) =>
	value
		.replaceAll("&amp;", "&")
		.replaceAll("&#x27;", "'")
		.replaceAll("&quot;", '"');

/**
 * What every studio page holds to, whatever its data and theme: one h1, only
 * allowed links (https ones with `rel="noopener noreferrer"`, none with
 * `target`), no text beside an element inside a link, no `style` attribute,
 * no `javascript:`, and every image with its size and its alt text (a work
 * thumbnail inside its "See work by" link has an empty one, TAT-116).
 */
export function assertSafePage(html: string, options: SafePageOptions = {}) {
	assert.equal(count(html, /<h1[\s>]/g), 1, "exactly one h1");
	for (const match of html.matchAll(/ href="([^"]*)"/g)) {
		const href = decodeAttribute(match[1]);
		assert.ok(isAllowedHref(href), href);
	}
	for (const anchor of html.match(/<a [^>]*>/g) ?? []) {
		if (/ href="https?:/.test(anchor)) {
			assert.match(anchor, / rel="noopener noreferrer"/, anchor);
		}
	}
	// Links are flex containers: text next to a <bdi> would become two flex
	// items and lose the space between them ("Ask forSita Rai"), so a link's
	// mixed content goes in one <span>.
	assert.doesNotMatch(
		html,
		/<a [^>]*>[^<]+<(?!\/a>)/,
		"text beside an element in a link",
	);
	assert.doesNotMatch(html, / target=/);
	assert.doesNotMatch(html, / style=/);
	assert.doesNotMatch(html, /javascript:/i);
	const covers = options.brandImages
		? Array.from(
				html.matchAll(
					/<(?:div class="(?:profile-cover|ink-hero-media)"|figure class="(?:irz-hero-figure|atl-plate atl-hero-plate|fp-plate fp-hero-plate)")>(<img [^>]*>)/g,
				),
				(match) => match[1],
			)
		: [];
	for (const image of html.match(/<img [^>]*>/g) ?? []) {
		assert.match(image, / width="\d+"/, image);
		assert.match(image, / height="\d+"/, image);
		assertSrcSet(image);
		if (
			options.brandImages &&
			/class="(profile-logo|site-bar-logo)"/.test(image)
		) {
			assert.match(image, / alt=""/, image);
		} else if (covers.includes(image)) {
			assert.match(image, / alt="[^"]*"/, image);
		} else if (/class="work-thumb"/.test(image)) {
			// Decorative inside a link whose own text names where it goes
			// (TAT-116): it must have an empty alt, and sit inside a work link.
			assert.match(image, / alt=""/, image);
			assert.ok(
				insideLink(html, image, "work-link"),
				`a work thumbnail outside a work link: ${image}`,
			);
		} else if (/class="ink-piece-photo"/.test(image)) {
			// Ink Noir's gallery card (Prompt 5): the same, inside the card's
			// link, which its title names.
			assert.match(image, / alt=""/, image);
			assert.ok(
				insideLink(html, image, "ink-piece-link"),
				`a gallery card's photo outside its link: ${image}`,
			);
		} else if (/class="ink-fresh-photo"/.test(image)) {
			// Ink Noir's Fresh ink tile (slice 3): the same, inside the viewer
			// button whose scrim names the post.
			assert.match(image, / alt=""/, image);
			assert.ok(
				insideLink(html, image, "ink-tile-open", true),
				`an Ink Noir Fresh ink photo outside its button: ${image}`,
			);
		} else if (/class="irz-piece-photo"/.test(image)) {
			// Irezumi's pieces: the same, inside the piece's link or viewer
			// button, which its title names.
			assert.match(image, / alt=""/, image);
			assert.ok(
				insideLink(html, image, "irz-piece-link", true),
				`an Irezumi piece's photo outside its link: ${image}`,
			);
		} else if (/class="atl-piece-photo"/.test(image)) {
			// Atelier's catalogue pieces: the same, inside the piece's link or
			// viewer button, which its title names.
			assert.match(image, / alt=""/, image);
			assert.ok(
				insideLink(html, image, "atl-piece-link", true),
				`an Atelier piece's photo outside its link: ${image}`,
			);
		} else if (/class="fp-piece-photo"/.test(image)) {
			// Flash Parlour's tattoos: the same, inside the piece's link or
			// viewer button, which its title names.
			assert.match(image, / alt=""/, image);
			assert.ok(
				insideLink(html, image, "fp-piece-link", true),
				`a Flash Parlour piece's photo outside its link: ${image}`,
			);
		} else if (/class="fp-card-picture"/.test(image)) {
			// Flash Parlour's flash sheets: the picture inside the sheet's link,
			// which the design's name names.
			assert.match(image, / alt=""/, image);
			assert.ok(
				insideLink(html, image, "fp-card-link"),
				`a Flash Parlour design's picture outside its link: ${image}`,
			);
		} else if (/class="irz-preview"/.test(image)) {
			// Irezumi's small previews of an artist's work, in a list hidden
			// from assistive technology beside the artist's name.
			assert.match(image, / alt=""/, image);
			assert.match(
				html,
				new RegExp(
					`<div class="irz-artist-previews" aria-hidden="true">(?:<img [^>]*>)*?${escapeRegExp(image)}`,
				),
				`an Irezumi preview outside its hidden row: ${image}`,
			);
		} else {
			assert.match(image, / alt="[^"]+"/, image);
		}
	}
}

/**
 * An image with `srcset` also has a non-empty `sizes`, and every candidate is
 * an http(s) URL with no space or comma and a whole width descriptor (TAT-112);
 * an image without `srcset` has no `sizes`.
 */
function assertSrcSet(image: string) {
	const srcset = / srcset="([^"]*)"/i.exec(image)?.[1];
	const sizes = / sizes="([^"]*)"/.exec(image)?.[1];
	if (srcset === undefined) {
		assert.equal(sizes, undefined, `sizes without srcset: ${image}`);
		return;
	}
	assert.ok(sizes && sizes.length > 0, `srcset without sizes: ${image}`);
	for (const candidate of decodeAttribute(srcset).split(", ")) {
		assert.match(candidate, /^https?:\/\/[^\s,]+ [1-9]\d*w$/, candidate);
	}
}

/**
 * Whether this exact image tag sits inside an `<a class="{className}">` in
 * `html` whose own text names it; with `button`, a viewer
 * `<button … class="{className}">` counts too (Irezumi's piece without a page
 * of its own).
 */
function insideLink(
	html: string,
	image: string,
	className: string,
	button = false,
): boolean {
	const tags = [
		`<a class="${className}"[^>]*>[\\s\\S]*?<\\/a>`,
		...(button
			? [`<button [^>]*class="${className}"[^>]*>[\\s\\S]*?<\\/button>`]
			: []),
	];
	for (const link of html.matchAll(new RegExp(tags.join("|"), "g"))) {
		if (link[0].includes(image) && /<span[^>]*>\s*[^<\s]/.test(link[0])) {
			return true;
		}
	}
	return false;
}

/** `text` as a literal in a regular expression. */
function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
