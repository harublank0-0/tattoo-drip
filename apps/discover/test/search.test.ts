import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	countryName,
	knownStyle,
	readCity,
	readCountry,
	readQuery,
	readStyle,
} from "../src/lib/search.ts";

describe("search-parameter readers", () => {
	test("text, countries and slugs: valid values only", () => {
		assert.equal(readQuery(" ink "), "ink");
		assert.equal(readQuery("a"), undefined);
		assert.equal(readQuery("x".repeat(81)), undefined);
		assert.equal(readQuery(42), undefined);
		assert.equal(readCountry("np"), "NP");
		for (const country of ["NPL", "N", "1P", 12, ["NP"], "XX"])
			assert.equal(readCountry(country), undefined, String(country));
		assert.equal(readCity("new-delhi"), "new-delhi");
		assert.equal(readCity("Pokhara"), undefined);
		assert.equal(readStyle("fine_line"), undefined);
		assert.equal(readStyle("x".repeat(64)), undefined);
		assert.equal(readStyle(7), undefined);
	});

	test("an unknown style is dropped once the style list is known", () => {
		const styles = [{ slug: "blackwork" }];
		assert.equal(knownStyle("blackwork", styles), "blackwork");
		assert.equal(knownStyle("glitter", styles), undefined);
		assert.equal(knownStyle("glitter", undefined), "glitter");
		assert.equal(knownStyle(undefined, styles), undefined);
	});

	test("a country's name", () => {
		assert.equal(countryName("NP"), "Nepal");
		assert.equal(countryName("np"), "Nepal");
	});
});
