import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { readRequestSearch, requestLink } from "../../src/studio/request.ts";
import {
	artistViewModels,
	studioViewModel,
} from "../../src/studio/view-model.ts";
import { ARJUN, CLOSED_STUDIO, SITA, STUDIO } from "./fixtures.ts";

const studio = studioViewModel(STUDIO);
const closedStudio = studioViewModel(CLOSED_STUDIO);
const [sita, arjun] = artistViewModels([SITA, ARJUN]);

describe("readRequestSearch", () => {
	test("the address keeps a well-formed artist slug and nothing else", () => {
		assert.deepEqual(readRequestSearch({ artist: "sita" }), { artist: "sita" });
		// The router hands over every value as the string in the address.
		assert.deepEqual(readRequestSearch({ artist: "12" }), { artist: "12" });
		assert.deepEqual(
			readRequestSearch({ artist: "sita", fbclid: "IwAR0", utm_source: "ig" }),
			{ artist: "sita" },
		);
		for (const artist of [
			"Sita",
			"-sita",
			"a",
			"",
			" sita",
			"sita ",
			"sita/../x",
			["sita", "arjun"],
			null,
			undefined,
			{},
			true,
			12,
			1.5,
			-3,
		])
			assert.deepEqual(readRequestSearch({ artist }), {}, String(artist));
		assert.deepEqual(readRequestSearch({ fbclid: "IwAR0" }), {});
		assert.deepEqual(readRequestSearch({}), {});
	});

	test("an inherited or prototype key is no artist", () => {
		assert.deepEqual(readRequestSearch(Object.create({ artist: "sita" })), {});
	});
});

describe("readRequestSearch with a flash design (TAT-129)", () => {
	const ID = "0199f000-0000-7000-8000-000000000001";

	test("the address keeps a well-formed flash id, and the design names the artist", () => {
		assert.deepEqual(readRequestSearch({ flash: ID, fbclid: "x" }), {
			flash: ID,
		});
		assert.deepEqual(readRequestSearch({ artist: "sita", flash: ID }), {
			flash: ID,
		});
	});

	test("an uppercase, cut-off, number-like or repeated flash id is dropped; the artist then stands", () => {
		for (const flash of [
			ID.toUpperCase(),
			ID.slice(0, 35),
			"moth",
			"",
			12,
			[ID, ID],
			null,
			undefined,
			`${ID} `,
		]) {
			assert.deepEqual(readRequestSearch({ flash }), {}, String(flash));
			assert.deepEqual(
				readRequestSearch({ artist: "sita", flash }),
				{ artist: "sita" },
				String(flash),
			);
		}
	});
});

describe("requestLink", () => {
	test("the header's Request: the artist while they take new work, else the studio while it does, else none", () => {
		assert.deepEqual(requestLink(studio, null), {
			href: "/request",
			artistName: null,
		});
		assert.deepEqual(requestLink(studio, sita), {
			href: "/request?artist=sita",
			artistName: "Sita Rai",
		});
		assert.deepEqual(requestLink(studio, arjun), {
			href: "/request",
			artistName: null,
		});
		assert.equal(requestLink(closedStudio, arjun), null);
		assert.equal(requestLink(closedStudio, null), null);
		assert.deepEqual(requestLink(closedStudio, sita), {
			href: "/request?artist=sita",
			artistName: "Sita Rai",
		});
	});
});
