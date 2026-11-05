import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Artist, Studio } from "@tattoo-drip/sdk";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { INFO_PAGES, type InfoKind } from "../../src/studio/info.ts";
import { type InfoPageData, infoPageData } from "../../src/studio/loaders.ts";
import { ThemedInfoPage } from "../../src/studio/theme/registry.tsx";
import { studioViewModel } from "../../src/studio/view-model.ts";
import {
	ARJUN,
	CLOSED_STUDIO,
	DEFAULT_STOREFRONT,
	EMPTY_STUDIO,
	GOOD_TO_KNOW_STUDIO,
	ORIGIN,
	SITA,
	STUDIO,
} from "./fixtures.ts";
import { assertSafePage } from "./safety.ts";
import { IMAGE_ORIGIN, withStorefront } from "./theme-fixtures.ts";

/**
 * Prompt 7's informational pages: each says only what the studio's profile,
 * its Good to know and its artists say (plus the approved facts about how
 * requesting works), leaves out what it lacks, and is a not-found with
 * nothing of its own.
 */

const inkNoir = (studio: Studio, sections?: string[]): Studio =>
	withStorefront(
		{
			...DEFAULT_STOREFRONT,
			theme: "ink-noir",
			...(sections ? { sections } : {}),
		},
		studio,
	);
const stencil = (studio: Studio): Studio =>
	withStorefront(DEFAULT_STOREFRONT, studio);

const data = (
	kind: InfoKind,
	studio: Studio = inkNoir(GOOD_TO_KNOW_STUDIO),
	artists: Artist[] = [SITA, ARJUN],
) => infoPageData(kind, studio, artists, ORIGIN, IMAGE_ORIGIN);
const html = (page: InfoPageData) =>
	renderToStaticMarkup(createElement(ThemedInfoPage, { data: page }));
const mainOf = (page: string) =>
	/<main[^>]*>([\s\S]*)<\/main>/.exec(page)?.[1] ?? "";

describe("the informational pages hold to every rule of a studio page", () => {
	test("in both themes, for a full studio, an independent artist and a studio that set little", () => {
		const studios = [
			GOOD_TO_KNOW_STUDIO,
			{ ...GOOD_TO_KNOW_STUDIO, type: "independent" as const },
			CLOSED_STUDIO,
			EMPTY_STUDIO,
		];
		for (const make of [inkNoir, stencil]) {
			for (const studio of studios) {
				for (const kind of INFO_PAGES) {
					const page = data(kind, make(studio));
					if (!page) continue;
					const markup = html(page);
					assertSafePage(markup, { brandImages: true });
					const ids = Array.from(
						markup.matchAll(/ id="([^"]*)"/g),
						(m) => m[1],
					);
					assert.deepEqual(ids, [...new Set(ids)], `${kind}: every id once`);
					assert.equal(page.seo.canonical, `${ORIGIN}/${kind}`);
				}
			}
		}
	});
});

describe("what each page says, and only that", () => {
	test("About: the studio's own words, its artists' styles and up to four artists; an independent artist is one person", () => {
		const page = data("about");
		assert.ok(page && page.content.kind === "about");
		// The studio's own words, its line breaks kept (normalised to \n).
		assert.deepEqual(page.content.story, [
			"Fine line and blackwork in Thamel.\nWalk-ins on Sundays.",
		]);
		assert.ok(page.content.specialties.length > 0);
		assert.deepEqual(
			page.content.artists.map((artist) => artist.slug),
			["sita", "arjun"],
		);
		const solo = data("about", inkNoir({ ...STUDIO, type: "independent" }));
		assert.ok(solo && solo.content.kind === "about");
		assert.equal(solo.content.artists.length, 1);
		assert.match(mainOf(html(solo)), /Meet the artist</);
		assert.doesNotMatch(mainOf(html(solo)), /Meet the artists/);
		// Nothing invented: no years, awards or a philosophy the studio never wrote.
		assert.doesNotMatch(
			mainOf(html(page)),
			/years of|award|since \d|philosophy|certified|hygien/i,
		);
	});

	test("Services: the styles the artists list, flash only when shown, custom work while someone takes it; no prices", () => {
		const page = data("services");
		assert.ok(page && page.content.kind === "services");
		assert.ok(page.content.styles.length > 0);
		for (const style of page.content.styles) {
			assert.ok(style.artists.length > 0);
			if (style.workHref) assert.match(style.workHref, /^\/gallery\?style=/);
		}
		assert.equal(page.content.flash, true);
		assert.equal(page.content.requestHref, "/book");
		const markup = mainOf(html(page));
		assert.doesNotMatch(markup, /NPR|\$\d|from \d|starting at|hour/i);
		assert.match(markup, /Prices aren&#x27;t listed here/);
		// No flash section shown: no flash offer. Nobody open: no custom request.
		const noFlash = data(
			"services",
			inkNoir(GOOD_TO_KNOW_STUDIO, ["work", "artists", "info"]),
		);
		assert.ok(noFlash && noFlash.content.kind === "services");
		assert.equal(noFlash.content.flash, false);
		const closed = data("services", inkNoir(CLOSED_STUDIO), [
			{ ...SITA, acceptingInquiries: false },
			ARJUN,
		]);
		assert.ok(closed && closed.content.kind === "services");
		assert.equal(closed.content.requestHref, null);
		// No artist: nothing true to list.
		assert.equal(data("services", inkNoir(STUDIO), []), null);
	});

	test("FAQ: how requesting works always; the studio's answers only where it wrote them, and not while Good to know is hidden", () => {
		const full = data("faq");
		assert.ok(full && full.content.kind === "faq");
		const ids = full.content.groups.flatMap((g) => g.items.map((i) => i.id));
		for (const id of [
			"how-to-book",
			"is-it-booked",
			"own-design",
			"walk-ins",
			"age",
			"deposit",
		]) {
			assert.ok(ids.includes(id), id);
		}
		const studioAnswers = full.content.groups
			.flatMap((g) => g.items)
			.filter((item) => item.source === "studio");
		assert.ok(studioAnswers.length > 0);
		const markup = mainOf(html(full));
		assert.match(
			markup,
			/<details id="how-to-book" class="faq-item"><summary class="faq-question"><span>How do I book a session\?<\/span><\/summary>/,
		);
		assert.match(markup, /Small flash welcome on Saturdays\./);

		const plain = data("faq", inkNoir(STUDIO));
		assert.ok(plain && plain.content.kind === "faq");
		assert.deepEqual(
			plain.content.groups.flatMap((g) => g.items.map((i) => i.source)),
			["product", "product", "product"],
		);
		const hidden = data(
			"faq",
			inkNoir(GOOD_TO_KNOW_STUDIO, ["work", "artists"]),
		);
		assert.ok(hidden && hidden.content.kind === "faq");
		assert.ok(
			hidden.content.groups
				.flatMap((g) => g.items)
				.every((i) => i.source === "product"),
		);
	});

	test("Contact: the studio's own channels, address with directions, hours and closed days; nothing to reach it by is a not-found", () => {
		const page = data("contact");
		assert.ok(page);
		const markup = mainOf(html(page));
		assert.match(markup, /Get directions/);
		assert.match(markup, /href="https:\/\/www\.google\.com\/maps\/search\//);
		assert.match(markup, /Opening hours/);
		assert.match(markup, /दशैं बिदा/);
		// No form: the API takes no general message (docs: Informational pages).
		assert.doesNotMatch(markup, /<form|<input|<textarea/);
		assert.equal(data("contact", inkNoir(EMPTY_STUDIO)), null);
		assert.equal(studioViewModel(EMPTY_STUDIO).pages.contact, false);
	});

	test("Policies: only the policies the studio set, with a contents list; none, or Good to know hidden, is a not-found", () => {
		const page = data("policies");
		assert.ok(page && page.content.kind === "policies");
		assert.deepEqual(
			page.content.sections.map((section) => section.id),
			["deposits", "age", "walk-ins", "closed-days"],
		);
		assert.match(mainOf(html(page)), /<a href="#deposits">Deposits<\/a>/);
		assert.equal(data("policies", inkNoir(STUDIO)), null);
		assert.equal(
			data("policies", inkNoir(GOOD_TO_KNOW_STUDIO, ["work"])),
			null,
		);
	});

	test("Aftercare: the studio's own instructions, marked as theirs; none is a not-found", () => {
		const page = data("aftercare");
		assert.ok(page && page.content.kind === "aftercare");
		const markup = mainOf(html(page));
		assert.match(
			markup,
			/These are <bdi>Black Needle<\/bdi>&#x27;s own instructions\./,
		);
		assert.equal(data("aftercare", inkNoir(STUDIO)), null);
	});

	test("each page has its own title and description from the studio's data", () => {
		const titles = INFO_PAGES.map((kind) => data(kind)?.seo.title);
		assert.deepEqual(titles, [
			"About Black Needle",
			"What we tattoo at Black Needle",
			"Questions about Black Needle",
			"Contact Black Needle",
			"Policies at Black Needle",
			"Aftercare from Black Needle",
		]);
		assert.equal(
			data("services", inkNoir({ ...GOOD_TO_KNOW_STUDIO, type: "independent" }))
				?.seo.title,
			"What Black Needle tattoos",
		);
	});
});
