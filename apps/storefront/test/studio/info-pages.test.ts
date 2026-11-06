import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Artist, Studio } from "@tattoo-drip/sdk";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { sectionId } from "../../src/studio/anchors.ts";
import { INFO_PAGES, type InfoKind } from "../../src/studio/info.ts";
import {
	type InfoPageData,
	infoPageData,
	studioPageData,
} from "../../src/studio/loaders.ts";
import {
	ThemedInfoPage,
	ThemedStudioPage,
} from "../../src/studio/theme/registry.tsx";
import { studioViewModel } from "../../src/studio/view-model.ts";
import {
	ARJUN,
	CLOSED_STUDIO,
	CONTENT_STUDIO,
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

	test("review fixes: nothing leads to a closed booking, empty pages are not-founds, closed days stand alone", () => {
		// Closed studio: Services offers flash only, and says no custom work.
		const closed = data("services", inkNoir(CLOSED_STUDIO));
		assert.ok(closed && closed.content.kind === "services");
		assert.equal(closed.content.requestHref, null);
		assert.doesNotMatch(closed.seo.description, /custom work/);
		assert.doesNotMatch(mainOf(html(closed)), /href="\/book/);
		// Closed and no flash: nothing to offer, a not-found.
		assert.equal(
			data("services", inkNoir(CLOSED_STUDIO, ["work", "artists", "info"])),
			null,
		);
		// The FAQ's "How do I book?" links the booking page only while it takes requests.
		const faq = data("faq", inkNoir(CLOSED_STUDIO));
		assert.ok(faq && faq.content.kind === "faq");
		assert.equal(faq.content.groups[0].items[0].link, null);
		// No introduction and no artist: no About.
		assert.equal(data("about", inkNoir(EMPTY_STUDIO), []), null);
		// Closed days show even without opening hours.
		const contact = data(
			"contact",
			inkNoir({ ...GOOD_TO_KNOW_STUDIO, openingHours: [] }),
		);
		assert.ok(contact);
		assert.match(mainOf(html(contact)), /Closed days/);
		// The h1 names the page for heading navigation.
		assert.match(
			mainOf(html(data("faq") as InfoPageData)),
			/<h1 class="ink-info-title"><span class="sr-only">FAQ: <\/span>/,
		);
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

describe("the studio's own FAQ and policies (2026-11-06 spec)", () => {
	test("the FAQ ends with the studio's own entries under From {studio}, in order, as text", () => {
		for (const make of [inkNoir, stencil]) {
			const page = data("faq", make(CONTENT_STUDIO));
			assert.ok(page && page.content.kind === "faq");
			const last = page.content.groups.at(-1);
			assert.equal(last?.id, "studio");
			assert.equal(last?.title, "From Black Needle");
			assert.deepEqual(
				last?.items.map((item) => [item.id, item.question, item.source]),
				[
					["studio-1", "Do you do cover-ups?", "studio"],
					["studio-2", "Can I bring a friend?", "studio"],
				],
			);
			const markup = mainOf(html(page));
			assert.doesNotMatch(markup, /<script>/);
			assert.match(
				markup,
				/<p class="user-text" dir="auto">&lt;script&gt;x&lt;\/script&gt;\nsecond<\/p>/,
			);
		}
	});

	test("Policies lists the Good to know sections first, then the studio's, with unique anchors and the date", () => {
		for (const make of [inkNoir, stencil]) {
			const page = data("policies", make(CONTENT_STUDIO));
			assert.ok(page && page.content.kind === "policies");
			const ids = page.content.sections.map((section) => section.id);
			assert.deepEqual(ids, [
				"deposits",
				"age",
				"walk-ins",
				"closed-days",
				"section-5",
				"cancellations",
				"cancellations-2",
			]);
			const markup = mainOf(html(page));
			for (const id of ids) {
				assert.match(markup, new RegExp(`<a href="#${id}">`), id);
				assert.match(markup, new RegExp(` id="${id}"`), id);
			}
			assert.match(markup, /Last updated 6 November 2026/);
		}
	});

	test("the studio's own FAQ group names the studio in <bdi>, never uppercased or letter-spaced", () => {
		const named = { ...CONTENT_STUDIO, name: "कालो सुई" };
		for (const make of [inkNoir, stencil]) {
			const page = data("faq", make(named));
			assert.ok(page);
			const markup = mainOf(html(page));
			assert.match(
				markup,
				/<h2 id="faq-studio-title" class="faq-group-title faq-group-title-studio">From <bdi>कालो सुई<\/bdi><\/h2>/,
			);
		}
		// Ink Noir's contents list names it the same way.
		const ink = mainOf(html(data("faq", inkNoir(named)) as InfoPageData));
		assert.match(ink, /<a href="#faq-studio">From <bdi>कालो सुई<\/bdi><\/a>/);
	});

	test("a section's anchor never takes an id the page already uses, its heading's included", () => {
		const clashing = {
			...CONTENT_STUDIO,
			policies: {
				updatedAt: null,
				sections: [
					"Main",
					"Info",
					"Info title",
					"Info close title",
					"Deposits title",
					"Ink footer more",
					"Cancellations",
					"Cancellations title",
				].map((title) => ({ title, text: `About ${title}.` })),
			},
		};
		for (const make of [inkNoir, stencil]) {
			const page = data("policies", make(clashing));
			assert.ok(page && page.content.kind === "policies");
			const markup = html(page);
			const ids = Array.from(markup.matchAll(/ id="([^"]*)"/g), (m) => m[1]);
			assert.deepEqual(ids, [...new Set(ids)], "every id on the page once");
			// Each contents link leads to its own section.
			for (const section of page.content.sections) {
				assert.match(
					markup,
					new RegExp(
						`<section id="${section.id}"[^>]*aria-labelledby="${section.id}-title"`,
					),
					section.title,
				);
			}
		}
	});

	test("a studio with only its own sections has a Policies page; one with neither is a not-found", () => {
		const own = data(
			"policies",
			inkNoir({ ...STUDIO, policies: CONTENT_STUDIO.policies }),
		);
		assert.ok(own && own.content.kind === "policies");
		assert.equal(own.content.sections.length, 3);
		assert.equal(
			studioViewModel({ ...STUDIO, policies: CONTENT_STUDIO.policies }).pages
				.policies,
			true,
		);
		assert.equal(data("policies", inkNoir(STUDIO)), null);
	});

	test("with Good to know hidden the studio's FAQ entries and sections show nowhere", () => {
		const hidden = inkNoir(CONTENT_STUDIO, ["work", "artists"]);
		const faq = data("faq", hidden);
		assert.ok(faq && faq.content.kind === "faq");
		assert.ok(faq.content.groups.every((group) => group.id !== "studio"));
		assert.equal(data("policies", hidden), null);
	});

	test("section anchors: an ASCII slug, a number on a repeat, section-<n> for a title with no ASCII letter", () => {
		const used = new Set<string>(["deposits"]);
		assert.equal(
			sectionId("Touch-ups & Healing!", used, 1),
			"touch-ups-healing",
		);
		assert.equal(sectionId("Deposits", used, 2), "deposits-2");
		assert.equal(sectionId("Deposits", used, 3), "deposits-3");
		assert.equal(sectionId("नीति", used, 4), "section-4");
		assert.equal(sectionId("नीति", used, 5), "section-5");
	});

	test("Stencil & Ink's footer links each informational page that has content, and none that doesn't", () => {
		const footerOf = (studio: Studio) => {
			const page = renderToStaticMarkup(
				createElement(ThemedStudioPage, {
					data: studioPageData(stencil(studio), [SITA, ARJUN], ORIGIN),
				}),
			);
			return /<footer[^>]*>([\s\S]*)<\/footer>/.exec(page)?.[1] ?? "";
		};
		const full = footerOf(CONTENT_STUDIO);
		assert.match(full, /<nav [^>]*aria-label="More about Black Needle">/);
		assert.match(full, /href="\/faq"/);
		assert.match(full, /href="\/policies"/);
		const empty = footerOf(EMPTY_STUDIO);
		assert.match(empty, /href="\/faq"/);
		assert.doesNotMatch(empty, /href="\/policies"|href="\/aftercare"/);
	});
});
