import { type HeadTags, headTags, type PageSeo } from "../seo.ts";
import { brandingCss } from "./branding.ts";
import type { ThemeConfig } from "./config.ts";

/** A route's head with the studio's brand: HeadTags and, when branded, one <style>. */
export interface ThemedHeadTags extends HeadTags {
	styles?: { children: string }[];
}

/**
 * The head of the studio page and the artist page (TAT-54): headTags, and for
 * a branded studio one <style> holding brandingCss (the router writes it as
 * it is, with the CSP nonce once one is set). The default theme's head is
 * exactly headTags: no <style>.
 */
export function themedHeadTags(
	seo: PageSeo,
	theme: ThemeConfig,
): ThemedHeadTags {
	const tags = headTags(seo);
	const css = brandingCss(theme);
	return css === null ? tags : { ...tags, styles: [{ children: css }] };
}
