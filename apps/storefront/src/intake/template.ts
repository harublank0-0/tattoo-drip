/*
 * The {placeholder} templates every page's copy uses (TAT-57). Kept out of
 * copy.ts so a page that only fills a template (the studio page's steps) does
 * not carry the whole intake form's words in its first chunk; copy.ts
 * re-exports these, so every older import still works.
 */

type Values = Readonly<Record<string, string | number>>;

const PLACEHOLDER = /\{(\w+)\}/g;

/** `template` with each {name} replaced by `values[name]`; a placeholder without a value stays. */
export function fill(template: string, values: Values = {}): string {
	return template.replace(PLACEHOLDER, (match, name: string) =>
		name in values ? String(values[name]) : match,
	);
}

export type Part = { readonly text: string } | { readonly value: string };

/** `template` as text and values, so a component can put the values in <bdi>. */
export function fillParts(template: string, values: Values): Part[] {
	const parts: Part[] = [];
	let text = "";
	let last = 0;
	for (const match of template.matchAll(PLACEHOLDER)) {
		const name = match[1];
		if (!(name in values)) continue;
		text += template.slice(last, match.index);
		if (text) parts.push({ text });
		text = "";
		parts.push({ value: String(values[name]) });
		last = match.index + match[0].length;
	}
	text += template.slice(last);
	if (text) parts.push({ text });
	return parts;
}
