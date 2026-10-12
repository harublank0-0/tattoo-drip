/**
 * Turns a business or artist name into a slug: lowercase letters, digits
 * and single hyphens, at most 63 characters.
 */
export function slugify(name: string) {
	return name
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 63)
		.replace(/-+$/, "");
}
