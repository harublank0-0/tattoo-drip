/**
 * The ids an informational page already uses besides its sections, in
 * either theme: the content's landmark and titles, and Ink Noir's footer
 * headings. A section's anchor never takes one (test: "a section's anchor
 * never takes an id the page already uses").
 */
export const PAGE_IDS: readonly string[] = [
	"main",
	"info-title",
	"info-close-title",
	"ink-footer-explore",
	"ink-footer-more",
	"ink-footer-contact",
	"ink-footer-visit",
	"ink-footer-follow",
];

/** Reserve a section's id and its heading's (`<id>-title`), as the page renders both. */
export function reserveSection(id: string, used: Set<string>): void {
	used.add(id);
	used.add(`${id}-title`);
}

/**
 * An anchor id for a policy section from its title: the title as a slug
 * (lowercase ASCII letters and digits joined by single hyphens), with -2,
 * -3… when it or its heading's id (`<id>-title`) is taken, and `section-<n>`
 * (n the section's place on the page, 1-based) when the title has no ASCII
 * letter or digit (Nepali, say). Reserves both ids in `used`. Pure.
 */
export function sectionId(title: string, used: Set<string>, n: number): string {
	const slug = title
		.normalize("NFKD")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	const base = slug === "" ? `section-${n}` : slug;
	const taken = (id: string) => used.has(id) || used.has(`${id}-title`);
	let id = base;
	for (let repeat = 2; taken(id); repeat++) id = `${base}-${repeat}`;
	reserveSection(id, used);
	return id;
}
