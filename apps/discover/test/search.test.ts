import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	countryName,
	humanizeSlug,
	knownStyle,
	readCountry,
	readStudioSearch,
	studioQuery,
} from "../src/lib/search.ts";

describe("/explore/studios's address", () => {
	test("every key comes back, undefined when missing or malformed", () => {
		assert.deepEqual(readStudioSearch({}), {
			q: undefined,
			country: undefined,
			city: undefined,
			style: undefined,
		});
		assert.deepEqual(
			readStudioSearch({
				q: " ink ",
				country: "np",
				city: "pokhara",
				style: "fine-line",
			}),
			{ q: "ink", country: "NP", city: "pokhara", style: "fine-line" },
		);
		for (const country of ["NPL", "N", "1P", 12, ["NP"]])
			assert.equal(readCountry(country), undefined, String(country));
		const bad = readStudioSearch({
			country: "NP",
			city: "Pokhara",
			style: "fine_line",
		});
		assert.equal(bad.city, undefined);
		assert.equal(bad.style, undefined);
		assert.equal(readStudioSearch({ style: "x".repeat(64) }).style, undefined);
		assert.equal(readStudioSearch({ style: 7 }).style, undefined);
	});

	test("a city needs its country", () => {
		assert.equal(readStudioSearch({ city: "pokhara" }).city, undefined);
		assert.equal(
			readStudioSearch({ country: "xx1", city: "pokhara" }).city,
			undefined,
		);
	});

	test("an unknown style is dropped once the style list is known", () => {
		const styles = [{ slug: "blackwork" }];
		assert.equal(knownStyle("blackwork", styles), "blackwork");
		assert.equal(knownStyle("glitter", styles), undefined);
		assert.equal(knownStyle("glitter", undefined), "glitter");
		assert.equal(knownStyle(undefined, styles), undefined);
	});

	test("the API query holds only the filters given (q travels as query)", () => {
		assert.equal(studioQuery({}), undefined);
		assert.deepEqual(
			studioQuery({
				q: "ink",
				country: "NP",
				city: "pokhara",
				style: "realism",
			}),
			{ query: "ink", country: "NP", city: "pokhara", style: "realism" },
		);
		assert.deepEqual(studioQuery({ city: "pokhara" }), undefined);
	});

	test("filter labels: a humanised slug and a country's name", () => {
		assert.equal(humanizeSlug("new-delhi"), "New delhi");
		assert.equal(countryName("NP"), "Nepal");
		assert.equal(countryName("np"), "Nepal");
	});
});
