import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ArtistPage, StudioPage } from "../../src/studio/components/pages.tsx";
import { artistPageData, studioPageData } from "../../src/studio/loaders.ts";
import {
	ARJUN,
	CLOSED_STUDIO,
	EMPTY_STUDIO,
	ORIGIN,
	SITA,
	STUDIO,
} from "./fixtures.ts";
import { firstDifference, SNAPSHOT_FILE } from "./snapshot.ts";

/**
 * The studio page's markup as it was before themes (TAT-54), recorded from
 * that code: the default theme must render exactly this. When the snapshot
 * file is missing, this test writes it and fails once; run the tests again.
 * To accept a deliberate change to the default look, delete the file, run
 * the tests twice and review its diff.
 */
function renderPages(): Record<string, string> {
	const artistHtml = (slug: string) => {
		const data = artistPageData(STUDIO, [SITA, ARJUN], slug, ORIGIN);
		assert.ok(data, slug);
		return renderToStaticMarkup(createElement(ArtistPage, { data }));
	};
	return {
		studio: renderToStaticMarkup(
			createElement(StudioPage, {
				data: studioPageData(STUDIO, [SITA, ARJUN], ORIGIN),
			}),
		),
		empty: renderToStaticMarkup(
			createElement(StudioPage, {
				data: studioPageData(EMPTY_STUDIO, [], ORIGIN),
			}),
		),
		closed: renderToStaticMarkup(
			createElement(StudioPage, {
				data: studioPageData(CLOSED_STUDIO, [ARJUN], ORIGIN),
			}),
		),
		"artist-sita": artistHtml("sita"),
		"artist-arjun": artistHtml("arjun"),
	};
}

test("the studio and artist pages render as they did before themes (TAT-54)", () => {
	const pages = renderPages();
	if (!existsSync(SNAPSHOT_FILE)) {
		writeFileSync(SNAPSHOT_FILE, `${JSON.stringify(pages, null, "\t")}\n`);
		assert.fail(
			"Recorded test/studio/default-theme.snapshot.json. Run the tests again.",
		);
	}
	const expected = JSON.parse(readFileSync(SNAPSHOT_FILE, "utf8")) as Record<
		string,
		string
	>;
	assert.deepEqual(Object.keys(pages), Object.keys(expected));
	for (const [name, html] of Object.entries(pages)) {
		assert.ok(
			html === expected[name],
			`${name}: ${firstDifference(html, expected[name])}`,
		);
	}
});
