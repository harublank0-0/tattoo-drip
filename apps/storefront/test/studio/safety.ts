import assert from "node:assert/strict";
import { isAllowedHref } from "../../src/studio/links.ts";

export interface SafePageOptions {
	/**
	 * A studio's logo and cover (TAT-54) are decoration beside its name: the
	 * logo (class `profile-logo` or `site-bar-logo`) must have `alt=""`, and
	 * the cover (the `<img>` inside `profile-cover`) may have an empty alt.
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
 * no `javascript:`, and every image with its size and its alt text.
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
				html.matchAll(/<div class="profile-cover">(<img [^>]*>)/g),
				(match) => match[1],
			)
		: [];
	for (const image of html.match(/<img [^>]*>/g) ?? []) {
		assert.match(image, / width="\d+"/, image);
		assert.match(image, / height="\d+"/, image);
		if (
			options.brandImages &&
			/class="(profile-logo|site-bar-logo)"/.test(image)
		) {
			assert.match(image, / alt=""/, image);
		} else if (covers.includes(image)) {
			assert.match(image, / alt="[^"]*"/, image);
		} else {
			assert.match(image, / alt="[^"]+"/, image);
		}
	}
}
