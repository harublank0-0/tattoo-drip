import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { discoverKeys } from "@tattoo-drip/react";
import {
	activeFilterCount,
	applyFilters,
	artistWorks,
	changeSearch,
	chooseCity,
	clearedSearch,
	DIRECTORY_LIMIT,
	type DirectorySearch,
	directoryQuery,
	directoryWorkQuery,
	filterChips,
	hasSearchParams,
	humanizeSlug,
	readCursor,
	readDirectorySearch,
	readIndependent,
	readSort,
	resolveDirectory,
	SORTS,
	searchFields,
	sortLabel,
	studioWorks,
	stylesIn,
} from "../src/lib/directory.ts";
import { directoryTitle } from "../src/lib/directory-loader.ts";

const EMPTY: DirectorySearch = {
	q: undefined,
	country: undefined,
	city: undefined,
	style: undefined,
	sort: undefined,
	independent: undefined,
	cursor: undefined,
};

describe("the directories' address (D07)", () => {
	test("every key comes back, undefined when missing or malformed", () => {
		assert.deepEqual(readDirectorySearch({}, "studios"), EMPTY);
		assert.deepEqual(
			readDirectorySearch(
				{
					q: " ink ",
					country: "np",
					city: "pokhara",
					style: "fine-line",
					sort: "-name",
					independent: "true",
					cursor: "WyJuYW1lIl0",
				},
				"artists",
			),
			{
				q: "ink",
				country: "NP",
				city: "pokhara",
				style: "fine-line",
				sort: "-name",
				independent: true,
				cursor: "WyJuYW1lIl0",
			},
		);
		// Studios have no `independent`.
		assert.equal(
			readDirectorySearch({ independent: true }, "studios").independent,
			undefined,
		);
		const bad = readDirectorySearch(
			{
				q: "a",
				country: "NPL",
				city: "pokhara",
				style: "Fine_Line",
				sort: "popular",
				independent: "yes",
				cursor: "not a cursor!",
			},
			"artists",
		);
		assert.deepEqual(bad, EMPTY);
		// The router parses `?q=42` to a number: still a search text.
		assert.equal(readDirectorySearch({ q: 42 }, "studios").q, "42");
	});

	test("a city needs its country in the address", () => {
		assert.equal(
			readDirectorySearch({ city: "pokhara" }, "studios").city,
			undefined,
		);
		assert.equal(
			readDirectorySearch({ country: "xx1", city: "pokhara" }, "studios").city,
			undefined,
		);
	});

	test("sorts: only the API's, newest is the default and left out", () => {
		assert.deepEqual([...SORTS], ["newest", "name", "-name"]);
		assert.equal(readSort("name"), "name");
		assert.equal(readSort("-name"), "-name");
		assert.equal(readSort("newest"), undefined);
		assert.equal(readSort("rating"), undefined);
		assert.equal(sortLabel("newest", "studios"), "Recently listed");
		assert.equal(sortLabel("newest", "artists"), "Recently added");
		assert.equal(sortLabel("-name", "artists"), "Name, Z to A");
	});

	test("cursors and booleans by shape", () => {
		assert.equal(readCursor("abc_-9"), "abc_-9");
		assert.equal(readCursor("a".repeat(1001)), undefined);
		assert.equal(readCursor("a=b"), undefined);
		assert.equal(readIndependent(false), false);
		assert.equal(readIndependent("false"), false);
		assert.equal(readIndependent(1), undefined);
	});

	test("the loader's filters: the address's country else the visitor's; a city only with its country", () => {
		const search = readDirectorySearch(
			{ country: "NP", city: "pokhara", style: "realism" },
			"studios",
		);
		assert.deepEqual(resolveDirectory(search, "NP", "realism"), {
			...search,
			country: "NP",
		});
		const implicit = readDirectorySearch({ q: "ink" }, "studios");
		assert.equal(resolveDirectory(implicit, "IN", undefined).country, "IN");
		// An unknown style was dropped by the loader.
		assert.equal(resolveDirectory(search, "NP", undefined).style, undefined);
	});

	test("the API query holds exactly the filters (q travels as query), with the page size", () => {
		assert.deepEqual(directoryQuery({ ...EMPTY, country: "NP" }, "studios"), {
			country: "NP",
			limit: DIRECTORY_LIMIT,
		});
		assert.deepEqual(
			directoryQuery(
				{
					q: "ink",
					country: "NP",
					city: "pokhara",
					style: "realism",
					sort: "name",
					independent: false,
					cursor: "abc",
				},
				"artists",
			),
			{
				query: "ink",
				country: "NP",
				city: "pokhara",
				style: "realism",
				independent: false,
				sort: "name",
				cursor: "abc",
				limit: 24,
			},
		);
		// Studios never send `independent`.
		assert.ok(
			!(
				"independent" in
				directoryQuery(
					{ ...EMPTY, country: "NP", independent: true },
					"studios",
				)
			),
		);
		// The recent-work read is the same for every page and sort.
		assert.deepEqual(
			directoryWorkQuery({
				...EMPTY,
				country: "NP",
				city: "pokhara",
				sort: "name",
				cursor: "abc",
				q: "ink",
			}),
			{ country: "NP", city: "pokhara", limit: 48 },
		);
	});

	test("query keys differ across countries, filters, sorts and pages", () => {
		const key = (filters: Partial<DirectorySearch>) =>
			JSON.stringify(
				discoverKeys.studios(
					directoryQuery({ ...EMPTY, country: "NP", ...filters }, "studios"),
				),
			);
		const keys = [
			key({}),
			key({ country: "IN" }),
			key({ style: "realism" }),
			key({ city: "pokhara" }),
			key({ q: "ink" }),
			key({ sort: "name" }),
			key({ cursor: "abc" }),
		];
		assert.equal(new Set(keys).size, keys.length);
	});

	test("every change starts again at the first page; a new country drops the city", () => {
		const page2: DirectorySearch = {
			...EMPTY,
			q: "ink",
			country: "NP",
			city: "pokhara",
			style: "realism",
			sort: "name",
			cursor: "abc",
		};
		assert.equal(changeSearch(page2, { style: "japanese" }).cursor, undefined);
		assert.equal(changeSearch(page2, { sort: "-name" }).cursor, undefined);
		assert.equal(changeSearch(page2, { q: "needle" }).cursor, undefined);
		const switched = changeSearch(page2, { country: "IN" });
		assert.deepEqual(
			[switched.country, switched.city, switched.q, switched.style],
			["IN", undefined, "ink", "realism"],
		);
		// The same country keeps the city.
		assert.equal(changeSearch(page2, { country: "NP" }).city, "pokhara");
		// Choosing a city makes an implicit country explicit.
		assert.deepEqual(chooseCity({ ...EMPTY, q: "ink" }, "kathmandu", "NP"), {
			...EMPTY,
			q: "ink",
			country: "NP",
			city: "kathmandu",
		});
		assert.equal(chooseCity(page2, undefined, "NP").city, undefined);
		assert.deepEqual(clearedSearch(page2), { country: "NP" });
	});

	test("applying the filter controls: first page, city with its country, the rest kept", () => {
		const next = applyFilters(
			{ ...EMPTY, q: "ink", cursor: "abc" },
			{ city: "pokhara", style: "realism", sort: "name", independent: true },
			"NP",
		);
		assert.deepEqual(next, {
			...EMPTY,
			q: "ink",
			country: "NP",
			city: "pokhara",
			style: "realism",
			sort: "name",
			independent: true,
		});
		const cleared = applyFilters(next, {}, "NP");
		assert.deepEqual(cleared, { ...EMPTY, q: "ink", country: "NP" });
	});

	test("chips remove only themselves; counts and form fields", () => {
		const search: DirectorySearch = {
			...EMPTY,
			q: "ink",
			city: undefined,
			style: "realism",
			independent: true,
			cursor: "abc",
		};
		const chips = filterChips(
			search,
			{ ...search, country: "NP" },
			{ styles: [{ slug: "realism", name: "Realism" }] },
		);
		assert.deepEqual(
			chips.map((chip) => [chip.key, chip.label]),
			[
				["q", "“ink”"],
				["style", "Realism"],
				["independent", "Independent"],
			],
		);
		const styleChip = chips.find((chip) => chip.key === "style");
		assert.deepEqual(styleChip?.remove, {
			...search,
			style: undefined,
			cursor: undefined,
		});
		// The implicit country stays implicit.
		assert.equal(styleChip?.remove.country, undefined);
		assert.equal(activeFilterCount(search), 2);
		assert.deepEqual(searchFields(search, ["q"]), [
			["style", "realism"],
			["independent", "true"],
		]);
		assert.equal(hasSearchParams(EMPTY), false);
		assert.equal(hasSearchParams({ ...EMPTY, sort: "name" }), true);
		assert.equal(humanizeSlug("new-delhi"), "New delhi");
	});

	test("titles name what the page lists", () => {
		const base = { ...EMPTY, country: "NP" };
		assert.equal(
			directoryTitle("studios", base, {}),
			"Tattoo studios in Nepal",
		);
		assert.equal(
			directoryTitle(
				"artists",
				{ ...base, city: "kathmandu", style: "blackwork" },
				{ city: "Kathmandu", style: "Blackwork" },
			),
			"Blackwork tattoo artists in Kathmandu",
		);
		assert.equal(
			directoryTitle("studios", { ...base, q: "ink" }, {}),
			'Studios matching "ink"',
		);
	});

	test("recent work per row and the styles present", () => {
		const tattoo = (
			id: string,
			artist: string,
			studio: string,
			type = "studio",
		) =>
			({
				id,
				artist: { id: artist, slug: artist, name: artist },
				studio: { slug: studio, name: studio, type },
			}) as never;
		const works = [
			tattoo("1", "a", "s"),
			tattoo("2", "b", "s"),
			tattoo("3", "a", "s"),
			tattoo("4", "a", "s"),
			tattoo("5", "a", "s"),
			tattoo("6", "c", "solo", "independent"),
		];
		assert.deepEqual(
			artistWorks({ id: "a" }, works).map(
				(each) => (each as { id: string }).id,
			),
			["1", "3", "4"],
		);
		assert.equal(studioWorks({ slug: "s" }, works, 5).length, 5);
		// An independent's business is not a studio row.
		assert.equal(studioWorks({ slug: "solo" }, works).length, 0);
		assert.deepEqual(
			stylesIn(
				[
					{ slug: "realism", name: "Realism" },
					{ slug: "japanese", name: "Japanese" },
					{ slug: "blackwork", name: "Blackwork" },
				],
				[
					{ styles: [{ slug: "blackwork" }] },
					{ styles: [{ slug: "realism" }] },
				],
			).map((style) => style.slug),
			["realism", "blackwork"],
		);
	});
});
