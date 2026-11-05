import type { Artist, Studio } from "@tattoo-drip/sdk";
import { INFO_PAGES, infoContent } from "./info.ts";
import {
	artistsHref,
	flashHref,
	infoHref,
	requestHref,
	workHref,
} from "./links.ts";
import { parseThemeConfig } from "./theme/config.ts";
import { storefrontInput } from "./theme/source.ts";
import { artistViewModels, studioViewModel } from "./view-model.ts";

/**
 * The studio's sitemap and robots.txt (Prompt 8). Pure. The sitemap lists the
 * pages the studio's own data makes real, on its own origin: the studio page,
 * its artists (the directory and each visible artist), the gallery, flash
 * while the Flash section is shown, the booking page while the studio takes
 * requests, and the informational pages with content of their own (the same
 * check as their routes, infoContent). Never a deposit page, a filtered or
 * paged address, or a gallery photo (those are many and change: the gallery
 * links them). robots.txt allows everything and names this studio's sitemap.
 */
export function sitemapPaths(
	studio: Studio,
	artists: readonly Artist[],
	imageOrigin: string | null,
): string[] {
	const view = studioViewModel(studio);
	const visible = artistViewModels(artists, imageOrigin);
	const { sections } = parseThemeConfig(storefrontInput(studio), imageOrigin);
	const paths = ["/"];
	if (visible.length > 0) {
		paths.push(artistsHref({}));
		for (const artist of visible) paths.push(artist.pageHref);
	}
	paths.push(workHref({}));
	if (sections.includes("flash")) paths.push(flashHref({}));
	if (view.accepting) paths.push(requestHref({}));
	for (const kind of INFO_PAGES) {
		if (infoContent(kind, studio, view, artists, visible, sections)) {
			paths.push(infoHref(kind));
		}
	}
	return paths;
}

/** The sitemap XML for these paths on `origin`; every URL escaped. */
export function sitemapXml(origin: string, paths: readonly string[]): string {
	const urls = paths
		.map((path) => `  <url><loc>${escapeXml(`${origin}${path}`)}</loc></url>`)
		.join("\n");
	return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

/** robots.txt: everything allowed, and where this studio's sitemap is. */
export function robotsTxt(origin: string): string {
	return `User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`;
}

function escapeXml(text: string): string {
	return text
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&apos;");
}
