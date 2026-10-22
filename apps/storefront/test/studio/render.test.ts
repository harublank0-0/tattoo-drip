import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Artist, Studio } from "@tattoo-drip/sdk";
import {
	createElement,
	isValidElement,
	type ReactElement,
	type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
	ArtistPage,
	ErrorPage,
	NotFoundPage,
	StudioPage,
} from "../../src/studio/components/pages.tsx";
import { isAllowedHref } from "../../src/studio/links.ts";
import { artistPageData, studioPageData } from "../../src/studio/loaders.ts";
import {
	ARJUN,
	CLOSED_STUDIO,
	EMPTY_STUDIO,
	ORIGIN,
	SITA,
	STUDIO,
} from "./fixtures.ts";

/** The first element of `type` in a component's returned tree (the component is called, not rendered). */
function findElement(node: ReactNode, type: string): ReactElement | undefined {
	if (!isValidElement(node)) return undefined;
	if (node.type === type) return node;
	const children = (node.props as { children?: ReactNode }).children;
	for (const child of Array.isArray(children) ? children : [children]) {
		const found = findElement(child, type);
		if (found) return found;
	}
	return undefined;
}

function studioHtml(
	studio: Studio = STUDIO,
	artists: Artist[] = [SITA, ARJUN],
) {
	return renderToStaticMarkup(
		createElement(StudioPage, {
			data: studioPageData(studio, artists, ORIGIN),
		}),
	);
}

function artistHtml(slug: string) {
	const data = artistPageData(STUDIO, [SITA, ARJUN], slug, ORIGIN);
	assert.ok(data, slug);
	return renderToStaticMarkup(createElement(ArtistPage, { data }));
}

const count = (html: string, pattern: RegExp) =>
	html.match(pattern)?.length ?? 0;
const decodeAttribute = (value: string) =>
	value
		.replaceAll("&amp;", "&")
		.replaceAll("&#x27;", "'")
		.replaceAll("&quot;", '"');
const hrefs = (html: string) =>
	Array.from(html.matchAll(/ href="([^"]*)"/g), (match) =>
		decodeAttribute(match[1]),
	);
const headings = (html: string) =>
	Array.from(html.matchAll(/<h([1-6])[\s>]/g), (match) => Number(match[1]));
const images = (html: string) => html.match(/<img [^>]*>/g) ?? [];
/** The first screen's markup: the page's <header class="profile">. */
const hero = (html: string) =>
	html.match(/<header class="profile">[\s\S]*?<\/header>/)?.[0] ?? "";
/** The text of each link in the <ul> a contact group labels (Chat, Follow). */
const groupLinks = (html: string, id: string) =>
	Array.from(
		(
			html.match(
				new RegExp(
					`<ul class="links" aria-labelledby="${id}">([\\s\\S]*?)</ul>`,
				),
			)?.[1] ?? ""
		).matchAll(/<a [^>]*>([^<]*)<\/a>/g),
		(match) => match[1],
	);
/** The step titles in one "How booking works" block. */
const stepTitles = (block: string) =>
	Array.from(
		block.matchAll(
			/<li class="step"><span class="step-title">([^<]*)<\/span>/g,
		),
		(match) => match[1],
	);
const BOOKING_STEPS = [
	"Send your idea",
	"Get a price on WhatsApp",
	"A deposit holds your date",
	"Your session",
];

/** What every page holds to, whatever its data. */
function assertSafePage(html: string) {
	assert.equal(count(html, /<h1[\s>]/g), 1, "exactly one h1");
	for (const href of hrefs(html)) assert.ok(isAllowedHref(href), href);
	for (const anchor of html.match(/<a [^>]*>/g) ?? []) {
		if (/ href="https?:/.test(anchor)) {
			assert.match(anchor, / rel="noopener noreferrer"/, anchor);
		}
	}
	// Links are flex containers: text next to a <bdi> would become two flex
	// items and lose the space between them ("Ask forSita Rai"), so a link's
	// mixed content goes in one <span>.
	assert.doesNotMatch(
		html,
		/<a [^>]*>[^<]+<(?!\/a>)/,
		"text beside an element in a link",
	);
	assert.doesNotMatch(html, / target=/);
	assert.doesNotMatch(html, / style=/);
	assert.doesNotMatch(html, /javascript:/i);
	for (const image of images(html)) {
		assert.match(image, / width="\d+"/, image);
		assert.match(image, / height="\d+"/, image);
		assert.match(image, / alt="[^"]+"/, image);
	}
}

describe("the studio page", () => {
	test("has its landmarks, headings and sections in order", () => {
		const html = studioHtml();

		assertSafePage(html);
		assert.equal(count(html, /<main[\s>]/g), 1);
		assert.equal(count(html, /<footer[\s>]/g), 1);
		// h1; the strip; Artists and its two artists; the inquiry; the panel beside the form.
		assert.deepEqual(headings(html), [1, 2, 2, 3, 3, 2, 2]);
		assert.equal(count(html, / id="inquiry"/g), 1);
		assert.match(
			html,
			/<h1 class="profile-name" dir="auto">Black Needle<\/h1>/,
		);
		assert.match(html, /Studio page by Tattoo Drip/);
	});

	test("links to the inquiry, each open artist and every contact", () => {
		const links = hrefs(studioHtml());

		assert.ok(links.includes("#inquiry"));
		assert.ok(links.includes("/artists/sita#inquiry"));
		assert.ok(
			!links.includes("/artists/arjun#inquiry"),
			"no Ask link for a closed artist",
		);
		for (const href of [
			"https://instagram.com/blackneedle",
			"https://wa.me/9779812345678",
			"viber://chat?number=%2B9779812345678",
			"tel:+9779812345678",
			"mailto:hello@black-needle.example",
		]) {
			assert.ok(links.includes(href), href);
		}
		assert.ok(
			links.some((href) =>
				href.startsWith("https://wa.me/9779812345678?text="),
			),
			"the prefilled inquiry",
		);
	});

	test("loads roster photos lazily, at their stored size", () => {
		const [image] = images(studioHtml());

		assert.ok(image);
		assert.match(image, / width="1200" height="1500"/);
		assert.match(image, / alt="Photo of Sita Rai"/);
		assert.match(image, / loading="lazy"/);
	});

	test("shows a closed artist's own words", () => {
		assert.match(
			studioHtml(),
			/<p class="note user-text measure" dir="auto">Books open in March\.<\/p>/,
		);
	});

	test("leaves out what an empty studio hasn't set", () => {
		const html = studioHtml(EMPTY_STUDIO, []);

		assertSafePage(html);
		assert.doesNotMatch(html, /<address/);
		assert.doesNotMatch(html, / id="artists"/);
		assert.deepEqual(headings(html), [1, 2, 2, 2]);
		assert.match(
			html,
			/Black Needle<\/bdi> hasn(&#x27;|')t added contact details yet\./,
		);
	});

	test("a studio not taking inquiries says so instead of offering them", () => {
		const html = studioHtml(CLOSED_STUDIO, [ARJUN]);

		assertSafePage(html);
		assert.ok(!hrefs(html).includes("#inquiry"));
		assert.match(html, /Not taking new inquiries right now/);
		assert.match(html, /isn(&#x27;|')t taking new inquiries right now\./);
		assert.match(
			html,
			/<h2 id="artists-title" class="section-title">Artist<\/h2>/,
		);
	});

	test("the inquiry section is headed by what it holds: an invitation only while open", () => {
		const heading = (html: string) =>
			html.match(/<h2 id="inquiry-title"[^>]*>([^<]*)<\/h2>/)?.[1];

		assert.equal(heading(studioHtml()), "Send an inquiry");
		// Closed, the heading must not invite while the text below refuses.
		const closed = studioHtml(CLOSED_STUDIO, [ARJUN]);
		assert.equal(heading(closed), "Inquiries");
		assert.doesNotMatch(closed, /Send an inquiry/);
		// TAT-57 mounts on this id and label either way.
		assert.equal(count(closed, / id="inquiry"/g), 1);
		assert.match(
			closed,
			/<section id="inquiry"[^>]* aria-labelledby="inquiry-title"/,
		);
	});

	test("hostile text stays text and hostile links never render", () => {
		const html = studioHtml(
			{
				...STUDIO,
				name: "</h1><script>alert(1)</script>",
				intro: "<img src=x onerror=alert(1)>",
				socialLinks: [{ platform: "instagram", url: "javascript:alert(1)" }],
			},
			[
				{
					...SITA,
					bio: "<b>bold</b>",
					photo: { url: "javascript:alert(1)", width: 10, height: 10 },
				},
			],
		);

		assertSafePage(html);
		assert.doesNotMatch(html, /<script/);
		assert.doesNotMatch(html, /<img /);
		assert.doesNotMatch(html, /<b>/);
		assert.match(html, /&lt;\/h1&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
		assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
	});

	test("bidi overrides and a byte order mark reach neither the page, the head nor a prefilled message", () => {
		const hostile = {
			...STUDIO,
			name: "\ufeffBlack \u202eNeedle\u202c",
			intro: "Walk-ins \u2067welcome\u2069 on Sundays.",
		};
		const artists = [
			{ ...SITA, name: "Sita \u202eRai", bio: "\u202dFine line" },
		];
		const data = studioPageData(hostile, artists, ORIGIN);
		const html = studioHtml(hostile, artists);
		const page = artistPageData(hostile, artists, "sita", ORIGIN);
		assert.ok(page);

		const carried = [
			html,
			renderToStaticMarkup(createElement(ArtistPage, { data: page })),
			JSON.stringify(data),
			JSON.stringify(page),
			...hrefs(html).map((href) => decodeURIComponent(href)),
		].join("\n");
		assert.doesNotMatch(carried, /[\u202a-\u202e\u2066-\u2069\ufeff]/u);
		assert.equal(data.studio.name, "Black Needle");
		assert.match(data.seo.title, /^Black Needle$/);
		assert.match(html, /<h1[^>]*>Black Needle<\/h1>/);
	});

	test("joiners survive in names and bios: a Devanagari conjunct and an emoji family", () => {
		const conjunct = "क्\u200dष";
		const family = "👨\u200d👩\u200d👧";
		const html = studioHtml({ ...STUDIO, name: `Ink ${conjunct}` }, [
			{ ...SITA, bio: `Family ${family}` },
		]);

		assert.ok(html.includes(`Ink ${conjunct}`));
		assert.ok(html.includes(`Family ${family}`));
	});
});

describe("the studio page's first screen (TAT-105)", () => {
	test("is the name, one location line, and the two ways in, in that order", () => {
		const top = hero(studioHtml());

		const at = (text: string) => {
			const index = top.indexOf(text);
			assert.ok(index >= 0, text);
			return index;
		};
		assert.match(top, /<h1 class="profile-name" dir="auto">Black Needle<\/h1>/);
		assert.match(
			top,
			/<p class="profile-location user-text" dir="auto">Thamel Marg, Kathmandu<\/p>/,
		);
		assert.ok(at("<h1") < at("profile-location"));
		assert.ok(at("profile-location") < at(">Send your idea<"));
		assert.ok(at(">Send your idea<") < at("<span>WhatsApp</span>"));
		assert.ok(at("<span>WhatsApp</span>") < at("How booking works"));
		// The intro comes after the buttons, so a long one can't push them off the screen.
		assert.ok(at("How booking works") < at("Fine line and blackwork"));
		assert.ok(at("Fine line and blackwork") < at('class="contact"'));
		assert.doesNotMatch(
			top,
			/Tattoo studio/,
			"the address replaces the generic line",
		);
	});

	test("Send your idea is the primary action and WhatsApp the secondary, with the plain chat link", () => {
		const top = hero(studioHtml());

		assert.match(
			top,
			/<a class="action action-primary" href="#inquiry">Send your idea<\/a>/,
		);
		assert.match(
			top,
			/<a class="action action-secondary" href="https:\/\/wa\.me\/9779812345678" rel="noopener noreferrer"><svg[^>]* aria-hidden="true"[^>]*>[\s\S]*?<\/svg><span>WhatsApp<\/span><\/a>/,
		);
		assert.doesNotMatch(top, /Send an inquiry/);
	});

	test("groups the contacts as Chat, Follow and Visit", () => {
		const html = studioHtml();

		assert.deepEqual(groupLinks(html, "contact-chat"), [
			"WhatsApp",
			"Viber",
			"Call",
			"Email",
		]);
		assert.deepEqual(groupLinks(html, "contact-follow"), [
			"Instagram",
			"Facebook",
			"TikTok",
			"Website",
		]);
		assert.match(html, /<p class="contact-label" id="contact-chat">Chat<\/p>/);
		assert.match(
			html,
			/<p class="contact-label" id="contact-follow">Follow<\/p>/,
		);
		assert.match(
			html,
			/<p class="contact-label" id="contact-visit">Visit<\/p>/,
		);
		assert.match(
			html,
			/<div class="street"><p class="user-text" dir="auto">Thamel Marg\nKathmandu<\/p><a class="text-link" href="https:\/\/www\.google\.com\/maps\/search\/\?[^"]*" rel="noopener noreferrer">Open in Google Maps<\/a><\/div>/,
		);
	});

	test("a group with nothing in it is left out", () => {
		const html = studioHtml(
			{
				...EMPTY_STUDIO,
				contact: {
					phone: null,
					email: "hi@black-needle.example",
					address: null,
				},
				socialLinks: [],
			},
			[],
		);

		assert.deepEqual(groupLinks(html, "contact-chat"), ["Email"]);
		assert.doesNotMatch(html, /contact-follow|contact-visit|>Follow<|>Visit</);
	});

	test("has the 4-step strip under the buttons and the same steps in the panel beside the form", () => {
		const html = studioHtml();
		const top = hero(html);
		const panel = html.match(/<aside [\s\S]*?<\/aside>/)?.[0] ?? "";

		assert.deepEqual(stepTitles(top), BOOKING_STEPS);
		assert.deepEqual(stepTitles(panel), BOOKING_STEPS);
		assert.match(
			top,
			/<h2 id="steps-strip-title"[^>]*>How booking works<\/h2>/,
		);
		assert.match(
			panel,
			/<h2 id="steps-panel-title"[^>]*>How booking works<\/h2>/,
		);
		assert.match(
			panel,
			/^<aside class="inquiry-aside" aria-labelledby="steps-panel-title">/,
		);
		// The panel says more than the strip: a line for each step, the studio's name in <bdi>.
		assert.match(panel, /<bdi>Black Needle<\/bdi> replies/);
		assert.match(panel, /Tattoo Drip never handles your money\./);
		assert.equal(count(top, /step-detail/g), 0);
		assert.equal(count(panel, /step-detail/g), 4);
	});

	test("the panel beside the form also offers the chat links", () => {
		const panel = studioHtml().match(/<aside [\s\S]*?<\/aside>/)?.[0] ?? "";

		assert.match(panel, /Prefer to chat\?/);
		assert.match(panel, /href="https:\/\/wa\.me\/9779812345678\?text=/);
	});

	test("a Devanagari studio keeps its name, location and steps whole", () => {
		const html = studioHtml(
			{
				...STUDIO,
				name: "ब्ल्याक निडल स्टुडियो",
				contact: { ...STUDIO.contact, address: "ठमेल\nकाठमाडौं" },
			},
			[ARJUN],
		);

		assertSafePage(html);
		assert.match(
			hero(html),
			/<h1 class="profile-name" dir="auto">ब्ल्याक निडल स्टुडियो<\/h1>/,
		);
		assert.match(hero(html), />ठमेल, काठमाडौं<\/p>/);
		assert.match(html, /<bdi>ब्ल्याक निडल स्टुडियो<\/bdi> replies/);
	});

	test("no WhatsApp number means one button: the others stay in the groups", () => {
		const top = hero(
			studioHtml({
				...STUDIO,
				contact: { ...STUDIO.contact, phone: null },
			}),
		);

		assert.match(top, /action-primary" href="#inquiry">Send your idea/);
		assert.doesNotMatch(top, /action-secondary/);
		assert.doesNotMatch(top, /wa\.me/);
	});

	test("a studio with nothing set still opens on its name, the type of studio and the way in", () => {
		const html = studioHtml(EMPTY_STUDIO, []);
		const top = hero(html);

		assertSafePage(html);
		assert.match(
			top,
			/<p class="profile-location user-text" dir="auto">Tattoo studio<\/p>/,
		);
		assert.match(top, /action-primary" href="#inquiry">Send your idea/);
		assert.doesNotMatch(
			top,
			/action-secondary|class="contact"|class="profile-intro/,
		);
		assert.deepEqual(stepTitles(top), BOOKING_STEPS);
	});

	test("an independent artist without an address is still named as one", () => {
		const html = studioHtml({ ...EMPTY_STUDIO, type: "independent" }, []);

		assert.match(hero(html), />Independent tattoo artist<\/p>/);
	});

	test("a studio not taking inquiries offers no steps, no Send your idea and no panel", () => {
		const html = studioHtml(CLOSED_STUDIO, [ARJUN]);

		assertSafePage(html);
		assert.doesNotMatch(
			html,
			/How booking works|Send your idea|<aside|step-title/,
		);
		assert.match(hero(html), /Not taking new inquiries right now/);
		// The chat links are still there to read.
		assert.deepEqual(groupLinks(html, "contact-chat"), [
			"WhatsApp",
			"Viber",
			"Call",
			"Email",
		]);
	});
});

describe("the artist page", () => {
	test("is the artist's own page, with the way back and the studio's contacts", () => {
		const html = artistHtml("sita");
		const links = hrefs(html);

		assertSafePage(html);
		// h1; the inquiry with its steps; the panel beside the form; the studio.
		assert.deepEqual(headings(html), [1, 2, 3, 2, 2]);
		assert.match(
			html,
			/<h1 id="artist-title" class="artist-title" dir="auto">Sita Rai<\/h1>/,
		);
		assert.match(html, /Tattoo artist at <bdi>Black Needle<\/bdi>/);
		assert.ok(links.includes("/"));
		assert.ok(links.includes("#inquiry"));
		assert.ok(
			links.some(
				(href) =>
					href.startsWith("https://wa.me/9779812345678?text=") &&
					href.includes("Sita%20Rai"),
			),
			"the prefilled inquiry names the artist",
		);
	});

	test("loads its photo first", () => {
		const [image] = images(artistHtml("sita"));

		assert.ok(image);
		assert.match(image, / loading="eager"/);
		assert.match(image, / fetchpriority="high"/i);
	});

	test("a closed artist's page offers the studio instead", () => {
		const html = artistHtml("arjun");
		const links = hrefs(html);

		assertSafePage(html);
		assert.ok(links.includes("/#inquiry"));
		assert.ok(!links.includes("#inquiry"));
		assert.match(html, /Books open in March\./);
		// The section refuses, so its heading doesn't invite.
		assert.match(html, /<h2 id="inquiry-title"[^>]*>Inquiries<\/h2>/);
		assert.doesNotMatch(html, /Send an inquiry/);
	});

	test("an open artist's page invites in the section's heading", () => {
		assert.match(
			artistHtml("sita"),
			/<h2 id="inquiry-title"[^>]*>Send an inquiry<\/h2>/,
		);
	});
});

describe("the status pages", () => {
	test("a not-found page leads back to the studio page", () => {
		const html = renderToStaticMarkup(createElement(NotFoundPage));

		assertSafePage(html);
		assert.match(html, /<h1[^>]*>Page not found<\/h1>/);
		assert.deepEqual(hrefs(html), ["/"]);
	});

	test("an error page offers the same address again", () => {
		const html = renderToStaticMarkup(
			createElement(ErrorPage, { retryHref: "/artists/sita" }),
		);

		assertSafePage(html);
		assert.match(
			html,
			/<h1[^>]*>This page can(&#x27;|')t load right now<\/h1>/,
		);
		assert.deepEqual(hrefs(html), ["/artists/sita"]);
	});

	test("an address with a fragment is offered without it: a deposit link's token lives there", () => {
		const html = renderToStaticMarkup(
			createElement(ErrorPage, {
				retryHref: "/deposit?x=1#tat65b-browser-pass-token-0123456789abcdefg",
			}),
		);

		assert.deepEqual(hrefs(html), ["/deposit?x=1"]);
		assert.doesNotMatch(html, /tat65b-browser-pass-token|href="[^"]*#/);
	});

	test("Try again reloads the page when the browser can, keeping the fragment", () => {
		let reloads = 0;
		let prevented = 0;
		const tree = ErrorPage({
			retryHref: "/deposit",
			reload: () => {
				reloads += 1;
			},
		});
		const link = findElement(tree, "a");
		assert.ok(link, "an anchor");
		(
			link.props as { onClick(event: { preventDefault(): void }): void }
		).onClick({
			preventDefault: () => {
				prevented += 1;
			},
		});
		assert.equal(prevented, 1);
		assert.equal(reloads, 1);
	});

	test("an address that isn't one of the page's own paths is not offered", () => {
		for (const retryHref of ["//evil.example", "https://evil.example", ""]) {
			const html = renderToStaticMarkup(
				createElement(ErrorPage, { retryHref }),
			);
			assert.deepEqual(hrefs(html), ["/"], retryHref);
		}
	});
});
