import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { studioCopy } from "../../src/studio/copy.ts";
import {
	ARTIST_FLASH_COUNT,
	closedNoteFor,
	EMPTY_FLASH,
	FLASH_ID,
	FLASH_PAGE_SIZE,
	flashDesignView,
	flashListView,
	flashQuery,
	HOME_FLASH_COUNT,
	MAX_FLASH_PAGE,
	readFlashSearch,
} from "../../src/studio/flash.ts";
import { artistViewModels } from "../../src/studio/view-model.ts";
import { ARJUN, flashId, flashPage, SITA } from "./fixtures.ts";

const IMAGE_ORIGIN = "https://api.example.com";

describe("flash designs (TAT-129)", () => {
	test("the sizes: 6 on the home page, 12 on an artist's, 24 on /flash, 48 at most", () => {
		assert.deepEqual(
			[HOME_FLASH_COUNT, ARTIST_FLASH_COUNT, FLASH_PAGE_SIZE, MAX_FLASH_PAGE],
			[6, 12, 24, 48],
		);
	});

	test("a design becomes a view with its links, alt and price", () => {
		const view = flashDesignView(flashPage(1).data[0], IMAGE_ORIGIN);

		assert.ok(view);
		assert.equal(view.id, flashId(1));
		assert.equal(view.name, "Moth");
		assert.equal(view.size, "About 3 in");
		assert.equal(view.priceText, "NPR 3,000");
		assert.equal(view.alt, "Moth, a flash design by Sita Rai");
		assert.deepEqual(view.artist, {
			slug: "sita",
			name: "Sita Rai",
			href: "/artists/sita",
		});
		assert.equal(view.href, `/flash/${flashId(1)}`);
		assert.equal(view.requestHref, `/request?flash=${flashId(1)}`);
		assert.equal(view.requestable, true);
		assert.ok(view.image.srcSet);
		assert.ok(view.largeSrc.endsWith(".png"));
		assert.equal(FLASH_ID.test(view.id), true);
	});

	test("a broken design is dropped; a list of broken parts keeps the good ones", () => {
		const good = flashPage(1).data[0];
		const broken = [
			{ ...good, id: undefined },
			{ ...good, id: flashId(2).toUpperCase() },
			{ ...good, id: flashId(3), name: "" },
			{ ...good, id: flashId(4), size: "x".repeat(61) },
			{
				...good,
				id: flashId(5),
				image: { ...good.image, url: "https://elsewhere.example/f.png" },
			},
		];
		for (const design of broken) {
			assert.equal(flashDesignView(design, IMAGE_ORIGIN), null);
		}

		const list = flashListView(
			{ ...flashPage(0), data: [...broken, good] },
			IMAGE_ORIGIN,
		);
		assert.deepEqual(
			list.designs.map((design) => design.id),
			[flashId(1)],
		);

		// An artist without a usable slug keeps the design, without the artist.
		const nameless = flashDesignView(
			{ ...good, artist: { slug: "Sita", name: "Sita Rai" } },
			IMAGE_ORIGIN,
		);
		assert.ok(nameless);
		assert.equal(nameless.artist, null);
		assert.equal(nameless.alt, "Moth, a flash design");
	});

	test("an older or broken answer is EMPTY_FLASH", () => {
		for (const answer of [undefined, null, "x", {}, 12, []]) {
			assert.equal(flashListView(answer, IMAGE_ORIGIN), EMPTY_FLASH);
		}
	});

	test("at most 48 designs are read, and a nextCursor with a space is null", () => {
		const many = flashListView(flashPage(60), IMAGE_ORIGIN);
		assert.equal(many.designs.length, 48);
		assert.equal(
			flashListView(flashPage(1, { nextCursor: "a b" }), IMAGE_ORIGIN)
				.nextCursor,
			null,
		);
		assert.equal(
			flashListView(flashPage(1, { nextCursor: "c2_-" }), IMAGE_ORIGIN)
				.nextCursor,
			"c2_-",
		);
	});

	test("the filter's artists are read from the answer", () => {
		const list = flashListView(flashPage(1), IMAGE_ORIGIN);
		assert.deepEqual(list.artists, [{ slug: "sita", name: "Sita Rai" }]);
		const bad = flashListView(
			flashPage(1, {
				filters: {
					artists: [
						{ slug: "Bad", name: "x" },
						{ slug: "arjun", name: "अर्जुन" },
					],
				},
			}),
			IMAGE_ORIGIN,
		);
		assert.deepEqual(bad.artists, [{ slug: "arjun", name: "अर्जुन" }]);
	});

	test("the address's filter is read strictly", () => {
		assert.deepEqual(
			readFlashSearch({ artist: "sita", cursor: "abc_-", fbclid: "x" }),
			{ artist: "sita", cursor: "abc_-" },
		);
		for (const search of [
			{ artist: "Sita" },
			{ cursor: "a b" },
			{ artist: "", cursor: "" },
			{ artist: 12, cursor: ["x"] },
		]) {
			assert.deepEqual(readFlashSearch(search), {});
		}
		assert.deepEqual(flashQuery({ artist: "sita", cursor: "c2" }, 24), {
			artist: "sita",
			cursor: "c2",
			limit: 24,
		});
		assert.deepEqual(Object.keys(flashQuery({}, 6)), ["limit"]);
	});

	test("status claimed makes the design claimed and never requestable; a missing status does not", () => {
		const [good] = flashPage(1).data;
		const view = (over: object) => {
			const made = flashDesignView({ ...good, ...over }, IMAGE_ORIGIN);
			assert.ok(made);
			return made;
		};

		assert.equal(view({ status: "available" }).claimed, false);
		// An older API sends no status: not claimed.
		const { status: _status, ...older } = good;
		const olderView = flashDesignView(older, IMAGE_ORIGIN);
		assert.ok(olderView);
		assert.equal(olderView.claimed, false);
		assert.equal(view({ status: "claimed" }).claimed, true);
		// Any other value is treated as claimed, as the contract says.
		assert.equal(view({ status: "sold" }).claimed, true);
		// Even a claimed design the API called requestable is not.
		assert.equal(
			view({ status: "claimed", requestable: true }).requestable,
			false,
		);
	});

	test("closedNoteFor is null for a claimed design: the Claimed badge says it", () => {
		const made = flashDesignView(
			{ ...flashPage(1).data[0], status: "claimed", requestable: false },
			IMAGE_ORIGIN,
		);
		assert.ok(made);

		assert.equal(
			closedNoteFor(made, artistViewModels([SITA, ARJUN], IMAGE_ORIGIN)),
			null,
		);
	});

	test("flashQuery asks for the available designs in the order the contract writes them", () => {
		assert.deepEqual(Object.keys(flashQuery({}, 6, true)), [
			"available",
			"limit",
		]);
		assert.deepEqual(flashQuery({}, 6, true), { available: true, limit: 6 });
		assert.deepEqual(Object.keys(flashQuery({}, 6)), ["limit"]);
	});

	test("closedNoteFor: null while requestable; the artist's words, else 'Not taking flash requests right now'", () => {
		const view = (over: object) => {
			const made = flashDesignView(
				{ ...flashPage(1).data[0], ...over },
				IMAGE_ORIGIN,
			);
			assert.ok(made);
			return made;
		};
		const artists = artistViewModels([SITA, ARJUN], IMAGE_ORIGIN);

		assert.equal(closedNoteFor(view({}), artists), null);
		assert.equal(
			closedNoteFor(
				view({
					requestable: false,
					artist: { slug: "arjun", name: "अर्जुन थापा" },
				}),
				artists,
			),
			"Books open in March.",
		);
		assert.equal(
			closedNoteFor(view({ requestable: false }), artists),
			studioCopy.flash.closed,
		);
		assert.equal(
			closedNoteFor(view({ requestable: false, artist: null }), []),
			"Not taking flash requests right now",
		);
	});
});
