import { createElement, Fragment } from "react";
import { fillParts } from "../copy.ts";

/**
 * A copy template with its values in <bdi> (names may be Nepali or
 * right-to-left, TAT-48 rule 12). The parts are passed as separate
 * children, so they need no keys.
 */
export function Fill({
	template,
	values,
}: {
	template: string;
	values: Readonly<Record<string, string | number>>;
}) {
	return createElement(
		Fragment,
		null,
		...fillParts(template, values).map((part) =>
			"text" in part ? part.text : createElement("bdi", null, part.value),
		),
	);
}
