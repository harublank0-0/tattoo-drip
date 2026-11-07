import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	applyGalleryFilters,
	changeGallery,
	clearedGallery,
	galleryChips,
	galleryFields,
	galleryFilterCount,
	galleryLabels,
	galleryQuery,
	galleryTitle,
	isFiltered,
	nextSearch,
	readArtistId,
	readGallerySearch,
	readStudioSlug,
	resolveGallery,
	SEARCH_BURST_GAP_MS,
	SEARCH_DEBOUNCE_MS,
	scopeNames,
	startsBurst,
} from "../src/lib/gallery.ts";
import { fixtures } from "./stub-api.ts";

const ARTIST = "0b6f8e2c-6a4a-4f1e-9a51-1b0c2d3e4f50";

describe("the gallery's address (D09)", () => {
	test("reads every key, undefined when malformed", () => {
		assert.deepEqual(readGallerySearch({}), {
			q: undefined,
			country: undefined,
			city: undefined,
			style: undefined,
			artist: undefined,
			studio: undefined,
			cursor: undefined,
		});
		assert.deepEqual(
			readGallerySearch({
				q: "  koi  ",
				country: "np",
				city: "kathmandu",
				style: "fine-line",
				artist: ARTIST.toUpperCase(),
				studio: "black-needle",
				cursor: "abc_DEF-1",
				sort: "popular",
				page: "2",
			}),
			{
				q: "koi",
				country: "NP",
				city: "kathmandu",
				style: "fine-line",
				artist: ARTIST,
				studio: "black-needle",
				cursor: "abc_DEF-1",
			},
		);
		// A city needs its country; bad shapes are dropped, never sent.
		const bad = readGallerySearch({
			q: "a",
			city: "kathmandu",
			style: "Fine Line",
			artist: "not-a-uuid",
			studio: "-x",
			cursor: "a+b",
			country: "nepal",
		});
		assert.deepEqual(Object.values(bad), Array(7).fill(undefined));
		assert.equal(readGallerySearch({ q: "a\u0001b" }).q, undefined);
		assert.equal(readGallerySearch({ q: "007" }).q, "007");
		assert.equal(readArtistId(ARTIST), ARTIST);
		assert.equal(readStudioSlug("ab"), undefined);
	});

	test("the page's country, else the visitor's; an artist's or studio's work is global unless named", () => {
		const plain = resolveGallery({ city: "pokhara" }, "NP", undefined);
		assert.equal(plain.country, "NP");
		// A city only when the address names its country.
		assert.equal(plain.city, undefined);
		assert.equal(
			resolveGallery({ country: "NP", city: "pokhara" }, "IN", undefined).city,
			"pokhara",
		);
		assert.equal(
			resolveGallery({ artist: ARTIST }, "NP", undefined).country,
			undefined,
		);
		assert.equal(
			resolveGallery({ studio: "black-needle" }, "NP", undefined).country,
			undefined,
		);
		assert.equal(
			resolveGallery({ studio: "black-needle", country: "IN" }, "NP", undefined)
				.country,
			"IN",
		);
		// The style is the checked one.
		assert.equal(
			resolveGallery({ style: "nope" }, "NP", undefined).style,
			undefined,
		);
	});

	test("the API query sends exactly what the page says, q as `query`", () => {
		assert.deepEqual(
			galleryQuery(
				resolveGallery(
					{ q: "koi", country: "NP", city: "pokhara", cursor: "c" },
					"IN",
					"blackwork",
				),
			),
			{
				query: "koi",
				country: "NP",
				city: "pokhara",
				style: "blackwork",
				cursor: "c",
				limit: 24,
			},
		);
		assert.deepEqual(
			galleryQuery(resolveGallery({ artist: ARTIST }, "NP", undefined)),
			{ artist: ARTIST, limit: 24 },
		);
	});

	test("changes start again at the first page; a new country drops the city", () => {
		const search = {
			q: "koi",
			country: "NP",
			city: "pokhara",
			style: "blackwork",
			cursor: "c",
		};
		assert.deepEqual(changeGallery(search, { style: "realism" }), {
			...search,
			style: "realism",
			cursor: undefined,
		});
		assert.deepEqual(changeGallery(search, { country: "IN" }), {
			q: "koi",
			country: "IN",
			city: undefined,
			style: "blackwork",
			cursor: undefined,
		});
		assert.deepEqual(clearedGallery({ ...search, artist: ARTIST }), {
			country: "NP",
		});
	});

	test("applying the filters: a city brings its country; no country, no city", () => {
		assert.deepEqual(
			applyGalleryFilters(
				{ q: "koi" },
				{ city: "pokhara", style: "realism" },
				"NP",
			),
			{
				q: "koi",
				style: "realism",
				cursor: undefined,
				city: "pokhara",
				country: "NP",
			},
		);
		assert.deepEqual(
			applyGalleryFilters({ artist: ARTIST }, { city: "pokhara" }, undefined),
			{ artist: ARTIST, style: undefined, cursor: undefined, city: undefined },
		);
	});

	test("chips remove only themselves; names come from the page's data", () => {
		const search = { q: "koi", artist: ARTIST, style: "blackwork" };
		const filters = resolveGallery(search, "NP", "blackwork");
		const chips = galleryChips(search, filters, {
			artist: "Sita Rai",
			style: "Blackwork",
		});
		assert.deepEqual(
			chips.map((chip) => chip.label),
			["“koi”", "By Sita Rai", "Blackwork"],
		);
		const artistChip = chips.find((chip) => chip.key === "artist");
		assert.deepEqual(artistChip?.remove, {
			q: "koi",
			artist: undefined,
			style: "blackwork",
			cursor: undefined,
		});
		assert.equal(galleryFilterCount(filters), 1);
		assert.equal(isFiltered(filters), true);
		assert.equal(isFiltered(resolveGallery({}, "NP", undefined)), false);
	});

	test("the artist's and studio's names from the photos, else a fallback", () => {
		const { tattoos } = fixtures(4);
		const [first] = tattoos;
		assert.ok(first?.artist.id);
		assert.deepEqual(
			scopeNames(
				{ artist: first.artist.id, studio: first.studio.slug },
				tattoos as never,
			),
			{ artist: first.artist.name, studio: first.studio.name },
		);
		// No photo names it: no name (never the address's text).
		assert.deepEqual(scopeNames({ studio: "gone-studio" }, []), {
			artist: undefined,
			studio: undefined,
		});
		const unnamed = resolveGallery({ studio: "totally-fake" }, "NP", undefined);
		const labels = galleryLabels(unnamed, {}, []);
		assert.equal(galleryTitle(unnamed, labels), "Tattoos from this studio");
		assert.deepEqual(
			galleryChips({ studio: "totally-fake" }, unnamed, labels).map(
				(chip) => chip.label,
			),
			["At this studio"],
		);
	});

	test("titles say what the page shows", () => {
		const f = (search: Parameters<typeof resolveGallery>[0], style?: string) =>
			resolveGallery(search, "NP", style);
		assert.equal(galleryTitle(f({}), {}), "Tattoo inspiration from Nepal");
		assert.equal(galleryTitle(f({ q: "koi" }), {}), 'Tattoos matching "koi"');
		assert.equal(
			galleryTitle(
				f({ style: "blackwork", country: "NP", city: "pokhara" }, "blackwork"),
				{
					style: "Blackwork",
					city: "Pokhara",
				},
			),
			"Blackwork tattoos in Pokhara",
		);
		assert.equal(
			galleryTitle(f({ artist: ARTIST }), { artist: "Sita Rai" }),
			"Tattoos by Sita Rai",
		);
		assert.equal(
			galleryTitle(f({ studio: "black-needle" }), { studio: "Black Needle" }),
			"Tattoos from Black Needle",
		);
	});

	test("the no-JavaScript form keeps the other filters as hidden fields, never the cursor", () => {
		assert.deepEqual(
			galleryFields(
				{ q: "koi", country: "NP", style: "blackwork", cursor: "c" },
				["q"],
			),
			[
				["country", "NP"],
				["style", "blackwork"],
			],
		);
	});
});

describe("the search box's rule (D09)", () => {
	test("waits about 400 ms", () => {
		assert.equal(SEARCH_DEBOUNCE_MS, 400);
	});

	test("a burst of typing starts with the first keystroke or after a pause", () => {
		assert.equal(startsBurst(undefined, 1000), true);
		assert.equal(startsBurst(1000, 1000 + SEARCH_DEBOUNCE_MS + 200), false);
		assert.equal(startsBurst(1000, 1000 + SEARCH_BURST_GAP_MS - 1), false);
		assert.equal(startsBurst(1000, 1000 + SEARCH_BURST_GAP_MS), true);
		assert.ok(SEARCH_BURST_GAP_MS > SEARCH_DEBOUNCE_MS);
	});

	test("searches with 2 to 80 characters, clears when emptied, ignores the rest", () => {
		assert.deepEqual(nextSearch("k", undefined), { apply: false });
		assert.deepEqual(nextSearch("ko", undefined), { apply: true, q: "ko" });
		assert.deepEqual(nextSearch("  koi ", undefined), {
			apply: true,
			q: "koi",
		});
		// Unchanged: no navigation.
		assert.deepEqual(nextSearch("koi ", "koi"), { apply: false });
		// One character while a search is on: keep the results.
		assert.deepEqual(nextSearch("k", "koi"), { apply: false });
		assert.deepEqual(nextSearch("", "koi"), { apply: true, q: undefined });
		assert.deepEqual(nextSearch("   ", undefined), { apply: false });
		assert.deepEqual(nextSearch("a".repeat(81), undefined), { apply: false });
		assert.deepEqual(nextSearch("a\u0007b", undefined), { apply: false });
	});
});
