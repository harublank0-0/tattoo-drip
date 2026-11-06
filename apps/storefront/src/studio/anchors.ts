/**
 * An anchor id for a policy section from its title: the title as a slug
 * (lowercase ASCII letters and digits joined by single hyphens), with -2,
 * -3… when an earlier section on the page took it, and `section-<n>` (n the
 * section's place on the page, 1-based) when the title has no ASCII letter
 * or digit (Nepali, say). Adds the id to `used`. Pure.
 */
export function sectionId(title: string, used: Set<string>, n: number): string {
	const slug = title
		.normalize("NFKD")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	const base = slug === "" ? `section-${n}` : slug;
	let id = base;
	for (let repeat = 2; used.has(id); repeat++) id = `${base}-${repeat}`;
	used.add(id);
	return id;
}
