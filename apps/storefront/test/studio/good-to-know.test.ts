import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Studio } from "@tattoo-drip/sdk";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GoodToKnowSection } from "../../src/studio/components/good-to-know.tsx";
import { StudioPage } from "../../src/studio/components/pages.tsx";
import {
	goodToKnowIsEmpty,
	goodToKnowView,
	openNowView,
} from "../../src/studio/good-to-know.ts";
import { studioPageData } from "../../src/studio/loaders.ts";
import { GOOD_TO_KNOW_STUDIO, ORIGIN, SITA, STUDIO } from "./fixtures.ts";
import { assertSafePage } from "./safety.ts";

/** The instant that is `local` on a Kathmandu wall clock (+05:45). */
const at = (local: string) =>
	new Date(Date.parse(`${local}Z`) - (5 * 60 + 45) * 60_000);

const NO_TEXTS: Studio["goodToKnow"] = {
	walkIns: null,
	ageRule: null,
	depositPolicy: null,
	beforeSession: null,
	aftercare: null,
};

const withTexts = (goodToKnow: Partial<typeof NO_TEXTS>): Studio => ({
	...STUDIO,
	goodToKnow: { ...NO_TEXTS, ...goodToKnow },
});

const sectionHtml = (studio: Studio) =>
	renderToStaticMarkup(
		createElement(GoodToKnowSection, { view: goodToKnowView(studio) }),
	);

/** The studio page with today's state computed at `when` (null: none, as studioPageData has it). */
function pageHtml(studio: Studio, when: Date | null) {
	const data = studioPageData(studio, [SITA], ORIGIN);
	return renderToStaticMarkup(
		createElement(StudioPage, {
			data: { ...data, openNow: openNowView(studio, when) },
		}),
	);
}

const count = (html: string, pattern: RegExp) =>
	html.match(pattern)?.length ?? 0;
const terms = (html: string) =>
	Array.from(html.matchAll(/<dt>([^<]*)<\/dt>/g), (match) => match[1]);

describe("a studio that filled nothing", () => {
	test("has no section, no cover line, and the same page as before", () => {
		const html = pageHtml(STUDIO, new Date());

		assert.doesNotMatch(html, /good-to-know/);
		assert.doesNotMatch(html, /profile-hours/);
		assert.equal(sectionHtml(STUDIO), "");
		assert.equal(goodToKnowIsEmpty(goodToKnowView(STUDIO)), true);
		assert.equal(openNowView(STUDIO, new Date()), null);
		assertSafePage(html);
	});
});

describe("the Good to know section", () => {
	test("every part shows when filled, in order: hours, closed days, walk-ins, age, deposit, then the two folded texts", () => {
		const html = sectionHtml(GOOD_TO_KNOW_STUDIO);

		assert.match(
			html,
			/<section id="good-to-know" class="section" aria-labelledby="good-to-know-title">/,
		);
		assert.match(
			html,
			/<h2 id="good-to-know-title" class="section-title">Good to know<\/h2>/,
		);
		assert.deepEqual(terms(html), [
			"Hours",
			"Closed days",
			"Walk-ins",
			"Age",
			"Deposit",
		]);
		assert.match(
			html,
			/<span class="know-when">Sun – Fri<\/span> <span>11 am – 8 pm<\/span>/,
		);
		assert.match(
			html,
			/<span class="know-when">Sat<\/span> <span>Closed<\/span>/,
		);
		assert.match(
			html,
			/<span class="know-when">2 – 4 Nov<\/span> <span class="user-text" dir="auto">दशैं बिदा, back on 5 November<\/span>/,
		);
		assert.match(
			html,
			/<dd class="user-text" dir="auto">Small flash welcome on Saturdays\.<\/dd>/,
		);
		assert.match(html, /18 and over, with a photo ID\./);
		assert.match(html, /A deposit holds your date\./);
		assert.equal(count(html, /<details class="know-more">/g), 2);
		const summaries = Array.from(
			html.matchAll(/<summary><span>([^<]*)<\/span>/g),
			(match) => match[1],
		);
		assert.deepEqual(summaries, ["Before your session", "Aftercare"]);
		assert.match(
			html,
			/<p class="user-text measure" dir="auto">Eat a good meal\.\nWear clothes that leave the spot free\.<\/p>/,
		);
		assert.match(html, /घाउ सफा राख्नुहोस्/);
		// The chevron is decoration.
		assert.equal(count(html, /<svg[^>]* aria-hidden="true"/g), 2);
		// The details are closed until the visitor opens one.
		assert.doesNotMatch(html, /<details[^>]* open/);
		assert.ok(html.indexOf("<dl") < html.indexOf("<details"));
	});

	test("a closed-days entry without a note says Closed", () => {
		const html = sectionHtml({
			...STUDIO,
			closedDays: [{ from: "2026-11-09", to: "2026-11-09", note: null }],
		});

		assert.match(
			html,
			/<span class="know-when">Mon 9 Nov<\/span> <span>Closed<\/span>/,
		);
	});

	test("each part alone shows alone", () => {
		const age = sectionHtml(withTexts({ ageRule: "18 and over." }));
		assert.equal(count(age, /<div class="know-item">/g), 1);
		assert.deepEqual(terms(age), ["Age"]);
		assert.doesNotMatch(age, /<details/);

		const aftercare = sectionHtml(withTexts({ aftercare: "Keep it clean." }));
		assert.doesNotMatch(aftercare, /<dl/);
		assert.equal(count(aftercare, /<details class="know-more">/g), 1);
		assert.match(aftercare, /Aftercare/);
		assert.doesNotMatch(aftercare, /Before your session/);

		const deposit = sectionHtml(
			withTexts({ depositPolicy: "Deposits hold dates." }),
		);
		assert.deepEqual(terms(deposit), ["Deposit"]);

		const hours = sectionHtml({
			...STUDIO,
			openingHours: [{ day: "mon", opens: "11:00", closes: "20:00" }],
		});
		assert.deepEqual(terms(hours), ["Hours"]);
		assert.match(hours, /Mon<\/span> <span>11 am – 8 pm/);
	});

	test("a blank text shows nothing", () => {
		assert.equal(sectionHtml(withTexts({ walkIns: "  \n " })), "");
	});

	test("studio text is text", () => {
		const html = sectionHtml({
			...GOOD_TO_KNOW_STUDIO,
			closedDays: [{ from: "2026-11-02", to: "2026-11-02", note: "<b>x</b>" }],
			goodToKnow: {
				...GOOD_TO_KNOW_STUDIO.goodToKnow,
				walkIns: '<img src=x onerror="alert(1)">',
				aftercare: "<script>alert(1)</script>",
			},
		});

		assert.doesNotMatch(html, /<b>|<img|<script/);
		assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/);
		assert.match(html, /&lt;script&gt;/);
	});

	test("an older API without the fields is a page without them", () => {
		const old = {
			...STUDIO,
			openingHours: undefined,
			closedDays: undefined,
			goodToKnow: undefined,
		} as unknown as Studio;
		const data = studioPageData(old, [SITA], ORIGIN);
		const html = renderToStaticMarkup(createElement(StudioPage, { data }));

		assert.equal(goodToKnowIsEmpty(data.goodToKnow), true);
		assert.equal(data.openNow, null);
		assert.doesNotMatch(html, /good-to-know|profile-hours/);
	});

	test("garbage from the API is dropped, not rendered", () => {
		const view = goodToKnowView({
			...STUDIO,
			openingHours: [
				{ day: "mon", opens: "99:00", closes: "20:00" },
			] as unknown as Studio["openingHours"],
			closedDays: "soon" as unknown as Studio["closedDays"],
			goodToKnow: { ...NO_TEXTS, walkIns: 5 as unknown as string },
		});

		assert.equal(goodToKnowIsEmpty(view), true);
	});
});

describe("the cover's line", () => {
	const profileHours = (html: string) =>
		/<p class="profile-hours">.*?<\/p>/.exec(html)?.[0];

	test("the server renders today's state only when it holds for the cache life, right after the location", () => {
		const open = pageHtml(GOOD_TO_KNOW_STUDIO, at("2026-10-30T19:48"));

		assert.equal(
			profileHours(open),
			'<p class="profile-hours"><strong>Open now</strong> · <span class="user-text" dir="auto">till 8 pm</span></p>',
		);
		assert.match(
			open,
			/<p class="profile-location user-text" dir="auto">[^<]*<\/p><p class="profile-hours">/,
		);
		assert.ok(open.indexOf("profile-heading") < open.indexOf("profile-hours"));
		assert.ok(open.indexOf("profile-hours") < open.indexOf("profile-actions"));
		assertSafePage(open);

		// At 19:49 it closes inside the cache life: the server leaves the line empty.
		assert.equal(
			profileHours(pageHtml(GOOD_TO_KNOW_STUDIO, at("2026-10-30T19:49"))),
			'<p class="profile-hours"></p>',
		);
	});

	test("during a closure it says closed today with the note, never open", () => {
		const html = pageHtml(GOOD_TO_KNOW_STUDIO, at("2026-11-02T12:00"));

		assert.equal(
			profileHours(html),
			'<p class="profile-hours"><strong>Closed today</strong> · <span class="user-text" dir="auto">दशैं बिदा, back on 5 November</span></p>',
		);
		assert.doesNotMatch(html, /Open now/);
	});

	test("a state without a detail has no separator", () => {
		const studio: Studio = {
			...STUDIO,
			closedDays: [{ from: "2026-11-02", to: "2026-11-02", note: null }],
			openingHours: [{ day: "tue", opens: "11:00", closes: "20:00" }],
		};

		assert.equal(
			profileHours(pageHtml(studio, at("2026-11-02T12:00"))),
			'<p class="profile-hours"><strong>Closed today</strong></p>',
		);
	});

	test("with no clock (studioPageData's own) the line is there but empty", () => {
		const html = pageHtml(GOOD_TO_KNOW_STUDIO, null);

		assert.equal(profileHours(html), '<p class="profile-hours"></p>');
	});

	test("no hours and no closed days, no cover line; an unknown timezone, none", () => {
		assert.equal(openNowView(STUDIO, at("2026-10-30T12:00")), null);
		assert.equal(
			openNowView(
				{ ...GOOD_TO_KNOW_STUDIO, timezone: "Mars/Olympus" },
				at("2026-10-30T12:00"),
			),
			null,
		);
		assert.doesNotMatch(
			pageHtml({ ...GOOD_TO_KNOW_STUDIO, timezone: "Mars/Olympus" }, null),
			/profile-hours/,
		);
	});

	test("closed days without weekly hours show the line on a closed day only", () => {
		const studio: Studio = {
			...STUDIO,
			closedDays: GOOD_TO_KNOW_STUDIO.closedDays,
		};

		assert.ok(openNowView(studio, null));
		assert.match(
			pageHtml(studio, at("2026-11-03T12:00")),
			/<strong>Closed today<\/strong>/,
		);
		assert.doesNotMatch(
			pageHtml(studio, at("2026-10-30T12:00")),
			/profile-hours/,
		);
	});

	test("the view carries what the browser needs to recompute", () => {
		const view = openNowView(GOOD_TO_KNOW_STUDIO, at("2026-10-30T13:00"));

		assert.ok(view);
		assert.equal(view.timezone, "Asia/Kathmandu");
		assert.equal(view.week.length, 7);
		assert.deepEqual(view.week[6], null);
		assert.deepEqual(view.week[0], { opens: "11:00", closes: "20:00" });
		assert.equal(view.closures.length, 1);
		assert.deepEqual(view.initial, { kind: "open", closes: "20:00" });
		// Serializable: loader data travels as JSON-like data.
		assert.deepEqual(JSON.parse(JSON.stringify(view)), view);
	});
});
