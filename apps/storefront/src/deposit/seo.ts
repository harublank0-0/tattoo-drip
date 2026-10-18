import { fill } from "../intake/copy.ts";
import type { HeadMeta, HeadTags } from "../studio/seo.ts";
import { headCopy } from "./head-copy.ts";

/*
 * The deposit page's head and headers (TAT-65b, spec ruling 6): never
 * indexed, never stored, no Referer for anything it loads or links to. The
 * studio's name comes from the lookup the server already made, so the
 * preview a chat app draws from the link (fetched without its fragment)
 * names the studio. No canonical link, og:url or JSON-LD.
 */

export const DEPOSIT_PAGE_HEADERS: Readonly<Record<string, string>> = {
	"Cache-Control": "no-store",
	"Referrer-Policy": "no-referrer",
	"X-Robots-Tag": "noindex, nofollow",
};

export function depositHead(studioName: string | null): HeadTags {
	const values = { studio: studioName ?? "" };
	const title = studioName
		? fill(headCopy.titleWithStudio, values)
		: headCopy.title;
	const description = studioName
		? fill(headCopy.descriptionWithStudio, values)
		: headCopy.description;
	const meta: HeadMeta[] = [
		{ title },
		{ name: "description", content: description },
		{ name: "robots", content: "noindex, nofollow" },
		{ name: "referrer", content: "no-referrer" },
		{ property: "og:type", content: "website" },
	];
	if (studioName) meta.push({ property: "og:site_name", content: studioName });
	meta.push(
		{ property: "og:title", content: title },
		{ property: "og:description", content: description },
		{ name: "twitter:card", content: "summary" },
	);
	return { meta, links: [], scripts: [] };
}
