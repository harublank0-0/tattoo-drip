import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	countryName,
	knownStyle,
	parseSearchText,
	readCity,
	readCountry,
	readQuery,
	readStyle,
	stringifySearchText,
} from "../src/lib/search.ts";

describe("search-parameter readers", () => {
	test("text, countries and slugs: valid values only", () => {
		assert.equal(readQuery(" ink "), "ink");
		assert.equal(readQuery("a"), undefined);
		assert.equal(readQuery("x".repeat(81)), undefined);
		assert.equal(readQuery(42), undefined);
		// The API refuses control characters (its NO_CONTROL rule): never sent.
		for (const bad of ["ab\u0001c", "ink\u007f", "a\u0000b"])
			assert.equal(readQuery(bad), undefined, JSON.stringify(bad));
		// Surrounding whitespace (tabs, newlines) is trimmed first, as the API does.
		assert.equal(readQuery("\tink\n"), "ink");
		assert.equal(readCountry("np"), "NP");
		for (const country of ["NPL", "N", "1P", 12, ["NP"], "XX"])
			assert.equal(readCountry(country), undefined, String(country));
		assert.equal(readCity("new-delhi"), "new-delhi");
		assert.equal(readCity("Pokhara"), undefined);
		assert.equal(readStyle("fine_line"), undefined);
		assert.equal(readStyle("x".repeat(64)), undefined);
		assert.equal(readStyle(7), undefined);
	});

	test("search values stay text: the router never reads them as JSON", () => {
		assert.deepEqual(
			parseSearchText("?q=true&sort=name&independent=false&x=null&n=007&e=1e3"),
			{
				q: "true",
				sort: "name",
				independent: "false",
				x: "null",
				n: "007",
				e: "1e3",
			},
		);
		assert.deepEqual(parseSearchText("q=fine+line&q=last"), { q: "last" });
		assert.equal(
			stringifySearchText({
				q: "true",
				independent: true,
				cursor: undefined,
				n: "007",
			}),
			"?q=true&independent=true&n=007",
		);
		assert.equal(stringifySearchText({ q: "fine line" }), "?q=fine+line");
		assert.equal(stringifySearchText({}), "");
		// A round trip keeps every value's text.
		const search = { q: "null", style: "fine-line", sort: "-name" };
		assert.deepEqual(parseSearchText(stringifySearchText(search)), search);
	});

	test("an unknown style is dropped once the style list is known", () => {
		const styles = [{ slug: "blackwork" }];
		assert.equal(knownStyle("blackwork", styles), "blackwork");
		assert.equal(knownStyle("glitter", styles), undefined);
		assert.equal(knownStyle(undefined, styles), undefined);
	});

	test("a country's name", () => {
		assert.equal(countryName("NP"), "Nepal");
		assert.equal(countryName("np"), "Nepal");
	});
});
