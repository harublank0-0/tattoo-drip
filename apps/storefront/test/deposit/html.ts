/** Small readers for react-dom/server's markup, shared by the deposit page's render tests. */

export const decode = (value: string) =>
	value
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">")
		.replaceAll("&quot;", '"')
		.replaceAll("&#x27;", "'")
		.replaceAll("&amp;", "&");

/** The markup's text without its tags. */
export const textOf = (html: string) => decode(html.replace(/<[^>]+>/g, ""));

/** Every opening tag named `name`. */
export const tags = (html: string, name: string): string[] =>
	html.match(new RegExp(`<${name}\\b[^>]*>`, "g")) ?? [];

/** An attribute's value in one tag, whatever its case. */
export const attr = (tag: string, name: string): string | undefined => {
	const value = new RegExp(` ${name}="([^"]*)"`, "i").exec(tag)?.[1];
	return value === undefined ? undefined : decode(value);
};

/** Every href, decoded. */
export const hrefs = (html: string): string[] =>
	Array.from(html.matchAll(/ href="([^"]*)"/g), (match) => decode(match[1]));
