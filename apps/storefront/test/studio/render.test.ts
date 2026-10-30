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
	WorkPage,
} from "../../src/studio/components/pages.tsx";
import type { PortfolioSearch, WorkSearch } from "../../src/studio/gallery.ts";
import {
	artistPageData,
	studioPageData,
	workPageData,
} from "../../src/studio/loaders.ts";
import { headTags } from "../../src/studio/seo.ts";
import {
	ARJUN,
	CLOSED_STUDIO,
	EMPTY_STUDIO,
	galleryPage,
	ORIGIN,
	SITA,
	SITA_PHOTO_URL,
	SITA_SIZED,
	SITA_SRCSET,
	STUDIO,
	sitaWithWork,
} from "./fixtures.ts";
import { assertSafePage } from "./safety.ts";
import { IMAGE_ORIGIN, withStorefront } from "./theme-fixtures.ts";

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

	test("a photo with copies carries srcset and sizes, still lazy; one without carries neither (TAT-112)", () => {
		const sized = renderToStaticMarkup(
			createElement(StudioPage, {
				data: studioPageData(STUDIO, [SITA_SIZED, ARJUN], ORIGIN),
			}),
		);
		assertSafePage(sized);
		const [image] = images(sized);

		assert.ok(image);
		assert.match(image, new RegExp(` srcSet="${SITA_SRCSET}"`, "i"));
		assert.match(image, / sizes="\(min-width: 48rem\) 8\.63rem, 6\.63rem"/);
		assert.match(image, / loading="lazy"/);
		assert.match(image, / width="1200" height="1500"/);
		assert.match(image, / alt="Photo of Sita Rai"/);
		// src stays the stored image, and the only <img> is Sita's (Arjun has none).
		assert.match(
			image,
			/ src="https:\/\/api\.example\.com\/uploads\/tenants\/t\/artist_photo\/sita\.jpg"/,
		);
		assert.equal(images(sized).length, 1);

		for (const plain of [studioHtml(), studioHtml(STUDIO, [ARJUN])]) {
			assert.doesNotMatch(plain, / srcset=/i);
			assert.doesNotMatch(plain, / sizes=/);
		}
	});

	test("a landscape photo asks for the width its 4:5 box needs (TAT-112)", () => {
		const landscape: Artist = {
			...SITA_SIZED,
			photo: {
				url: SITA_PHOTO_URL,
				width: 2000,
				height: 1500,
				variants: [
					{ url: SITA_PHOTO_URL.replace(".jpg", ".320w.jpg"), width: 320 },
					{ url: SITA_PHOTO_URL.replace(".jpg", ".640w.jpg"), width: 640 },
					{ url: SITA_PHOTO_URL.replace(".jpg", ".1280w.jpg"), width: 1280 },
				],
			},
		};
		const html = renderToStaticMarkup(
			createElement(StudioPage, {
				data: studioPageData(STUDIO, [landscape], ORIGIN),
			}),
		);
		const [image] = images(html);

		// 2000 x 1500 is enlarged to fill a 4:5 box: 5/4 x 4/3 = 1.67 x the box's width.
		assert.ok(image);
		assert.match(image, / sizes="\(min-width: 48rem\) 14\.38rem, 11\.05rem"/);
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

		assert.equal(heading(studioHtml()), "Send your idea");
		// Closed, the heading must not invite while the text below refuses.
		const closed = studioHtml(CLOSED_STUDIO, [ARJUN]);
		assert.equal(heading(closed), "Inquiries");
		assert.doesNotMatch(closed, /Send your idea/);
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
					photo: {
						url: "javascript:alert(1)",
						width: 10,
						height: 10,
						variants: [],
					},
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
		assert.match(top, /<ol class="steps" role="list">/);
		assert.match(panel, /<ol class="steps" role="list">/);
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

	test("its photo picks a copy by width, is still eager and high, and og:image stays the stored image (TAT-112)", () => {
		const data = artistPageData(STUDIO, [SITA_SIZED, ARJUN], "sita", ORIGIN);
		assert.ok(data);
		const html = renderToStaticMarkup(createElement(ArtistPage, { data }));
		assertSafePage(html);
		const [image] = images(html);

		assert.ok(image);
		assert.match(image, new RegExp(` srcSet="${SITA_SRCSET}"`, "i"));
		assert.match(
			image,
			/ sizes="\(min-width: 48rem\) 19\.63rem, \(min-width: 22\.875rem\) 20rem, calc\(100vw - 2\.875rem\)"/,
		);
		assert.match(image, / loading="eager"/);
		assert.match(image, / fetchpriority="high"/i);
		assert.equal(data.seo.image?.src, SITA_PHOTO_URL);
		assert.deepEqual(
			headTags(data.seo).meta.find(
				(tag) => "property" in tag && tag.property === "og:image",
			),
			{ property: "og:image", content: SITA_PHOTO_URL },
		);
		for (const plain of [artistHtml("sita"), artistHtml("arjun")]) {
			assert.doesNotMatch(plain, / srcset=/i);
			assert.doesNotMatch(plain, / sizes=/);
		}
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
		assert.doesNotMatch(html, /Send your idea/);
	});

	test("an open artist's page invites in the section's heading, and its hero button says the same", () => {
		const html = artistHtml("sita");

		assert.match(html, /<h2 id="inquiry-title"[^>]*>Send your idea<\/h2>/);
		assert.match(
			html,
			/<a class="action action-primary" href="#inquiry">Send your idea<\/a>/,
		);
		assert.doesNotMatch(html, /Send an inquiry/);
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

describe("the roster's work strip (TAT-116)", () => {
	const roster = (artists: Artist[]) =>
		renderToStaticMarkup(
			createElement(StudioPage, {
				data: studioPageData(STUDIO, artists, ORIGIN, IMAGE_ORIGIN),
			}),
		);
	const thumbs = (html: string) =>
		html.match(/<img class="work-thumb"[^>]*>/g) ?? [];

	test("five photos show the first three in one link to the artist's work", () => {
		const html = roster([sitaWithWork(5, ["Koi on the forearm"]), ARJUN]);

		assertSafePage(html);
		assert.equal(thumbs(html).length, 3);
		assert.equal(count(html, /<a class="work-link"/g), 1);
		const [link] = html.match(/<a class="work-link"[^>]*>[\s\S]*?<\/a>/) ?? [];
		assert.ok(link);
		assert.match(link, /^<a class="work-link" href="\/artists\/sita#work">/);
		assert.equal(thumbs(link).length, 3);
		assert.match(
			link,
			/<span class="work-link-text"><span>See work by <bdi>Sita Rai<\/bdi><\/span><\/span><\/a>$/,
		);
		for (const image of thumbs(html)) {
			assert.match(image, / alt=""/);
			assert.match(image, / loading="lazy"/);
			assert.match(image, / decoding="async"/);
			assert.match(image, / width="2048" height="1536"/);
			// A 4:3 photo covering a square is enlarged to 4/3 x 5rem.
			assert.match(image, / sizes="6\.67rem"/);
			assert.match(
				image,
				/ srcSet="[^"]*320w, [^"]*640w, [^"]*1280w, [^"]*2048w"/i,
			);
		}
		// The first three, in the studio's order.
		assert.deepEqual(
			thumbs(html).map((image) => /w(\d)\.320-640-1280/.exec(image)?.[1]),
			["1", "2", "3"],
		);
	});

	test("the link's words sit in one inner span, so a flex row can't drop the space before the name", () => {
		const html = roster([sitaWithWork(1), ARJUN]);
		// The row is a flex container: text next to a <bdi> would be two flex
		// items and lose its space, as "See work bySita Rai" did in the browser.
		assert.match(
			html,
			/<span class="work-link-text"><span>See work by <bdi>Sita Rai<\/bdi><\/span><\/span>/,
		);
		assert.doesNotMatch(html, /<span class="work-link-text">[^<]/);
	});

	test("two photos show two; none shows no link; a closed artist still shows their work", () => {
		const two = roster([sitaWithWork(2), ARJUN]);
		assert.equal(thumbs(two).length, 2);
		assert.equal(count(two, /<a class="work-link"/g), 1);

		const none = roster([SITA, ARJUN]);
		assert.equal(count(none, /work-link|work-strip|work-thumb/g), 0);

		const closed = roster([
			{ ...ARJUN, workPhotos: sitaWithWork(1).workPhotos },
		]);
		assert.match(closed, /<a class="work-link" href="\/artists\/arjun#work">/);
		assert.match(closed, /See work by <bdi>अर्जुन थापा<\/bdi>/);
		assertSafePage(closed);
	});

	test("the link comes after the bio and the closed message, before 'Ask for'", () => {
		const html = roster([sitaWithWork(3), ARJUN]);
		const body = html.slice(html.indexOf('<div class="artist-body">'));
		assert.ok(body.indexOf("Fine line florals") < body.indexOf("work-link"));
		assert.ok(body.indexOf("work-link") < body.indexOf("Ask for"));
	});

	test("without the API's origin no work photo reaches the page", () => {
		const html = renderToStaticMarkup(
			createElement(StudioPage, {
				data: studioPageData(STUDIO, [sitaWithWork(3)], ORIGIN),
			}),
		);
		assert.equal(count(html, /work-link/g), 0);
	});

	test("a work thumbnail outside a work link fails the safety check", () => {
		const loose =
			'<h1>x</h1><img class="work-thumb" src="https://a.example/x.jpg" width="1" height="1" alt="">';
		assert.throws(() => assertSafePage(loose));
	});

	test("a hostile description never reaches the roster: the thumbnails are decorative", () => {
		const html = roster([sitaWithWork(1, ['"><script>alert(1)</script>'])]);
		assertSafePage(html);
		assert.doesNotMatch(html, /<script>alert/);
		assert.doesNotMatch(html, /alert\(1\)/);
	});
});

describe("Recent work on the studio page (TAT-126)", () => {
	const SECTION = /<section id="recent-work"[\s\S]*?<\/section>/;
	const homeWith = (
		recentWork: unknown,
		studio: Studio = STUDIO,
		artists: Artist[] = [SITA, ARJUN],
	) =>
		renderToStaticMarkup(
			createElement(StudioPage, {
				data: studioPageData(studio, artists, ORIGIN, IMAGE_ORIGIN, recentWork),
			}),
		);
	const recent = (html: string) => html.match(SECTION)?.[0] ?? "";
	const sectionsConfig = (...types: string[]) =>
		withStorefront({
			theme: "stencil-and-ink",
			sections: types.map((type) => ({ type })),
		});

	test("comes after the intro and before the artists, with the newest photos and All work", () => {
		const html = homeWith(galleryPage(12));

		assertSafePage(html);
		const work = html.indexOf('<section id="recent-work"');
		assert.ok(work > html.indexOf("profile-intro"), "after the intro");
		assert.ok(
			work < html.indexOf('<section id="artists"'),
			"before the artists",
		);
		assert.ok(work < html.indexOf('id="inquiry"'), "before the form");
		const section = recent(html);
		assert.match(
			section,
			/^<section id="recent-work" class="section" aria-labelledby="recent-work-title"><h2 id="recent-work-title" class="section-title">Recent work<\/h2>/,
		);
		// The newest nine of the twelve, each opening its own viewer.
		assert.equal(count(section, /<button [^>]*class="work-open"/g), 9);
		assert.equal(count(section, /<dialog /g), 9);
		assert.equal(count(html, /<ul class="work-grid" role="list">/g), 1);
		// All work: a link to /work after the grid, its arrow hidden from screen readers.
		const link = section.match(
			/<a class="text-link" href="\/work">[\s\S]*?<\/a>/,
		)?.[0];
		assert.ok(link, "a link to /work");
		assert.match(
			link,
			/^<a class="text-link" href="\/work"><span>All work<\/span><svg[^>]* aria-hidden="true"/,
		);
		assert.equal(
			link.replace(/<svg[\s\S]*?<\/svg>/, "").replace(/<[^>]+>/g, ""),
			"All work",
		);
		assert.ok(section.indexOf("</ul>") < section.indexOf('href="/work"'));
		assert.equal(count(html, /href="\/work"/g), 1);
	});

	test("the photos load the copy that fits, lazily, like every grid", () => {
		const grid =
			recent(homeWith(galleryPage(3))).match(
				/<img class="work-photo"[^>]*>/g,
			) ?? [];

		assert.equal(grid.length, 3);
		for (const image of grid) {
			assert.match(image, / loading="lazy"/);
			assert.match(image, / sizes="/);
			assert.match(image, / srcSet="/i);
		}
	});

	test("no photos, no Recent work and no All work link", () => {
		for (const none of [
			null,
			undefined,
			galleryPage(0),
			{ data: [] },
			"broken",
		]) {
			const html = homeWith(none);
			assertSafePage(html);
			assert.equal(recent(html), "");
			assert.doesNotMatch(html, /Recent work|All work/);
			assert.equal(count(html, /href="\/work"/g), 0);
		}
		// An empty gallery leaves the page as it is without one.
		assert.equal(homeWith(galleryPage(0)), homeWith(undefined));
	});

	test("a studio that hides Recent work shows none even with photos", () => {
		const html = homeWith(galleryPage(5), sectionsConfig("artists", "inquiry"));

		assertSafePage(html);
		assert.equal(recent(html), "");
		assert.doesNotMatch(html, /Recent work|All work|work-open|<dialog /);
		assert.ok(html.includes('<section id="artists"'));
	});

	test("artists before Recent work when the configuration says so", () => {
		const html = homeWith(
			galleryPage(4),
			sectionsConfig("artists", "work", "inquiry"),
		);

		const artists = html.indexOf('<section id="artists"');
		const work = html.indexOf('<section id="recent-work"');
		const form = html.indexOf('id="inquiry"');
		assert.ok(artists > 0 && artists < work && work < form);
	});

	test("Recent work can come after the form", () => {
		const html = homeWith(
			galleryPage(4),
			sectionsConfig("inquiry", "work", "artists"),
		);

		const order = ['id="inquiry"', 'id="recent-work"', 'id="artists"'].map(
			(marker) => html.indexOf(marker),
		);
		assert.ok(order[0] > 0 && order[0] < order[1] && order[1] < order[2]);
	});

	test("an older API's configuration, [artists, inquiry], shows no Recent work even with photos", () => {
		const html = homeWith(
			galleryPage(5),
			withStorefront({
				theme: "stencil-and-ink",
				sections: [{ type: "artists" }, { type: "inquiry" }],
			}),
		);

		assert.equal(recent(html), "");
	});

	test("the viewer names the artist with a link, and the styles and healed mark", () => {
		const html = homeWith(galleryPage(3));
		const [first = ""] =
			recent(html).match(/<dialog [^>]*>[\s\S]*?<\/dialog>/g) ?? [];

		assert.match(
			first,
			/<div class="work-dialog-meta"><p><a class="text-link" href="\/artists\/sita"><bdi>Sita Rai<\/bdi><\/a><\/p><p>Fine line<\/p><p>Healed<\/p><\/div>/,
		);
		// A later photo has the artist link but no style and no healed mark.
		const [, second = ""] =
			recent(html).match(/<dialog [^>]*>[\s\S]*?<\/dialog>/g) ?? [];
		assert.match(second, /<a class="text-link" href="\/artists\/sita">/);
		assert.doesNotMatch(second, /Healed/);
	});

	test("a hostile description or artist name is text, never markup", () => {
		const page = galleryPage(2);
		const html = homeWith({
			...page,
			data: page.data.map((photo) => ({
				...photo,
				alt: '"><script>alert(1)</script>',
				artist: { slug: "sita", name: "<img src=x onerror=alert(1)>" },
			})),
		});

		assertSafePage(html);
		assert.doesNotMatch(html, /<script>alert|<img src=x/);
	});

	test("the section never has more than nine photos, whatever the API sent", () => {
		const section = recent(homeWith(galleryPage(30)));

		assert.equal(count(section, /<button [^>]*class="work-open"/g), 9);
		assert.equal(count(section, /<dialog /g), 9);
	});
});

describe("the artist page's portfolio and viewer (TAT-126)", () => {
	const portfolioOf = (
		page: unknown,
		search: PortfolioSearch = {},
		artists: Artist[] = [SITA, ARJUN],
		slug = "sita",
	) => {
		const data = artistPageData(STUDIO, artists, slug, ORIGIN, IMAGE_ORIGIN, {
			page,
			search,
		});
		assert.ok(data);
		return renderToStaticMarkup(createElement(ArtistPage, { data }));
	};
	const dialogs = (html: string) =>
		html.match(/<dialog [^>]*>[\s\S]*?<\/dialog>/g) ?? [];
	const section = (html: string) =>
		html.match(/<section id="work"[\s\S]*?<\/section>/)?.[0] ?? "";
	const withAlts = (alts: (string | null)[]) => {
		const page = galleryPage(alts.length);
		return {
			...page,
			data: page.data.map((photo, index) => ({
				...photo,
				alt: alts[index],
			})),
		};
	};

	test("a Work section follows the profile and comes before the inquiry", () => {
		const html = portfolioOf(galleryPage(5));

		assertSafePage(html);
		const work = html.indexOf('<section id="work"');
		assert.ok(work > html.indexOf("</article>"), "after the profile");
		assert.ok(work < html.indexOf('id="inquiry"'), "before the inquiry");
		assert.match(
			html,
			/<section id="work" class="section" aria-labelledby="work-title"><h2 id="work-title" class="section-title">Work<\/h2>/,
		);
		// h1; Work; the inquiry with its steps; the panel; the studio.
		assert.deepEqual(headings(html), [1, 2, 2, 3, 2, 2]);
	});

	test("the artist page shows the whole portfolio with All and Healed", () => {
		const html = portfolioOf(galleryPage(3));
		const work = section(html);
		const nav = work.match(/<nav [^>]*>[\s\S]*?<\/nav>/)?.[0] ?? "";

		assert.match(
			nav,
			/^<nav class="work-filter-nav" aria-label="Which photos">/,
		);
		assert.match(
			nav,
			/<a href="\/artists\/sita#work" aria-current="page">All<\/a>/,
		);
		assert.match(nav, /<a href="\/artists\/sita\?healed=1#work">Healed<\/a>/);
		assert.equal(count(nav, /aria-current/g), 1);
		assert.equal(count(work, /class="work-open"/g), 3);

		const healed = section(portfolioOf(galleryPage(3), { healed: true }));
		assert.match(healed, /<a href="\/artists\/sita#work">All<\/a>/);
		assert.match(
			healed,
			/<a href="\/artists\/sita\?healed=1#work" aria-current="page">Healed<\/a>/,
		);
	});

	test("without a healed photo there is no filter", () => {
		const page = galleryPage(3, { filters: { styles: [], healed: false } });
		const html = portfolioOf(page);

		assertSafePage(html);
		assert.equal(count(section(html), /<nav/g), 0);
		assert.equal(count(section(html), /class="work-open"/g), 3);
	});

	test("healed asked for with none: the filter stays, and the page says so", () => {
		const page = galleryPage(0, { filters: { styles: [], healed: false } });
		const work = section(portfolioOf(page, { healed: true }));

		assert.match(work, /<nav /);
		assert.match(work, /aria-current="page">Healed<\/a>/);
		assert.match(work, /<p[^>]*>No healed photos yet\.<\/p>/);
		assert.equal(count(work, /work-grid|<dialog/g), 0);
	});

	test("Show more links to the next page with the same filter", () => {
		const page = galleryPage(3, { nextCursor: "c2" });
		const html = portfolioOf(page, { healed: true });
		const more =
			html.match(/<a [^>]*class="[^"]*work-more[^"]*"[^>]*>[^<]*<\/a>/g) ?? [];

		assert.equal(more.length, 1);
		assert.match(
			more[0],
			/^<a class="action action-secondary work-more" href="\/artists\/sita\?healed=1&amp;cursor=c2#work">Show more<\/a>$/,
		);
		assertSafePage(html);
		// No next page, no link.
		assert.equal(count(portfolioOf(galleryPage(3)), /work-more/g), 0);
		// Unfiltered, the cursor is the only parameter.
		assert.match(
			portfolioOf(page),
			/href="\/artists\/sita\?cursor=c2#work">Show more/,
		);
	});

	test("a cursor page offers the way back to the newest, keeping the filter", () => {
		const page = galleryPage(3);
		const back = (html: string) =>
			html.match(/<a [^>]*>Back to the newest<\/a>/g) ?? [];

		assert.deepEqual(back(portfolioOf(page, { healed: true, cursor: "c2" })), [
			'<a class="text-link" href="/artists/sita?healed=1#work">Back to the newest</a>',
		]);
		assert.deepEqual(back(portfolioOf(page, { cursor: "c2" })), [
			'<a class="text-link" href="/artists/sita#work">Back to the newest</a>',
		]);
		assert.deepEqual(back(portfolioOf(page)), []);
	});

	test("each photo is a button that names its own dialog", () => {
		const html = portfolioOf(galleryPage(5));
		const buttons = html.match(/<button [^>]*class="work-open"[^>]*>/g) ?? [];

		assert.equal(buttons.length, 5);
		buttons.forEach((button, index) => {
			const n = index + 1;
			assert.match(button, / type="button"/);
			assert.match(button, / aria-haspopup="dialog"/);
			assert.match(button, new RegExp(` id="work-open-${n}"`));
			assert.match(button, new RegExp(` aria-controls="work-photo-${n}"`));
			assert.ok(html.includes(` id="work-photo-${n}"`));
		});
		assert.equal(count(html, /<ul class="work-grid" role="list">/g), 1);
	});

	test("a dialog has its label, a Close form, the large copy (lazy) and its facts", () => {
		const html = portfolioOf(galleryPage(3));
		const all = dialogs(html);

		assert.equal(all.length, 3);
		all.forEach((dialog, index) => {
			const n = index + 1;
			assert.match(
				dialog,
				new RegExp(
					`^<dialog id="work-photo-${n}" class="work-dialog" aria-label="Photo ${n}">`,
				),
			);
			assert.match(
				dialog,
				new RegExp(
					`<form class="work-dialog-bar" method="dialog"><p>Photo ${n}</p><button type="submit" class="action action-secondary">Close</button></form>`,
				),
			);
			const large = dialog.match(/<img class="work-large"[^>]*>/g) ?? [];
			assert.equal(large.length, 1);
			// The widest copy up to 1280 px: never the 2048 px original.
			assert.match(
				large[0],
				new RegExp(
					` src="https://api\\.example\\.com/uploads/tenants/t/artist_work_photo/w${n}\\.1280w\\.jpg"`,
				),
			);
			assert.match(large[0], / loading="lazy"/);
			assert.match(large[0], / width="2048" height="1536"/);
			assert.doesNotMatch(large[0], / srcset=/i);
		});
		assert.doesNotMatch(html, /<dialog[^>]* open/);
	});

	test("the grid's photos load the copy that fits, lazily", () => {
		const grid =
			portfolioOf(galleryPage(3)).match(/<img class="work-photo"[^>]*>/g) ?? [];

		assert.equal(grid.length, 3);
		for (const image of grid) {
			assert.match(image, / loading="lazy"/);
			assert.match(image, / decoding="async"/);
			assert.match(image, / sizes="/);
			assert.match(image, / srcSet="/i);
			assert.match(image, / src="https:\/\/api\.example\.com\//);
		}
	});

	test("a description is the alt of the grid photo and the large one, and the caption; without one the alt names the artist", () => {
		const html = portfolioOf(
			withAlts(["Koi on the forearm", null, "कालो माछा"]),
		);
		const [first = "", second = "", third = ""] = dialogs(html);

		assert.match(first, /alt="Koi on the forearm"/);
		assert.match(
			first,
			/<p class="work-dialog-caption user-text" dir="auto">Koi on the forearm<\/p>/,
		);
		assert.match(second, /alt="Tattoo by Sita Rai, photo 2"/);
		assert.doesNotMatch(second, /work-dialog-caption/);
		assert.match(
			third,
			/<p class="work-dialog-caption user-text" dir="auto">कालो माछा<\/p>/,
		);
		const grid = html.match(/<img class="work-photo"[^>]*>/g) ?? [];
		assert.match(grid[0] ?? "", / alt="Koi on the forearm"/);
		assert.match(grid[1] ?? "", / alt="Tattoo by Sita Rai, photo 2"/);
	});

	test("a hostile description is text, never markup", () => {
		const html = portfolioOf(withAlts(['"><script>alert(1)</script>']));

		assertSafePage(html);
		assert.doesNotMatch(html, /<script>alert/);
		assert.match(html, /&quot;&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
	});

	test("on the artist's own page the viewer names the styles and Healed but has no link to that page", () => {
		const dialog = dialogs(portfolioOf(galleryPage(2)))[0] ?? "";

		assert.match(
			dialog,
			/<div class="work-dialog-meta"><p>Fine line<\/p><p>Healed<\/p><\/div>/,
		);
		assert.doesNotMatch(dialog, /href=/);
		// The second photo has neither, so no empty block.
		assert.doesNotMatch(
			dialogs(portfolioOf(galleryPage(2)))[1] ?? "",
			/work-dialog-meta/,
		);
	});

	test("the viewer's styles are joined, and a hostile style name is text", () => {
		const page = galleryPage(1);
		const styled = {
			...page,
			data: [
				{
					...page.data[0],
					healed: false,
					styles: [
						{ slug: "a", name: "Blackwork" },
						{ slug: "b", name: "<b>Realism</b>" },
					],
				},
			],
		};
		const html = portfolioOf(styled);

		assertSafePage(html);
		assert.match(
			dialogs(html)[0] ?? "",
			/<div class="work-dialog-meta"><p>Blackwork · &lt;b&gt;Realism&lt;\/b&gt;<\/p><\/div>/,
		);
	});

	test("without photos, and no filter asked, the page has no Work section and no dialog", () => {
		for (const page of [null, galleryPage(0), undefined, { data: "x" }]) {
			const html = portfolioOf(page);

			assert.equal(count(html, /work-|<dialog/g), 0);
			assert.deepEqual(headings(html), [1, 2, 3, 2, 2]);
		}
	});

	test("the artist's six newest do not make a portfolio: the section is the portfolio read's", () => {
		const html = portfolioOf(null, {}, [sitaWithWork(5), ARJUN]);

		assert.equal(count(html, /class="work-open"/g), 0);
		assert.equal(count(html, /id="work"/g), 0);
	});

	test("a closed artist's page still shows their work", () => {
		const page = galleryPage(2);
		const html = portfolioOf(
			{
				...page,
				data: page.data.map((photo) => ({
					...photo,
					artist: { slug: "arjun", name: "अर्जुन थापा" },
				})),
			},
			{},
			[ARJUN],
			"arjun",
		);

		assertSafePage(html);
		assert.equal(count(html, /class="work-open"/g), 2);
		assert.match(html, /alt="Tattoo by अर्जुन थापा, photo 1"/);
	});
});

describe("the All work page (TAT-126)", () => {
	const BINA: Artist = {
		...SITA,
		id: "0199f000-0000-7000-8000-000000000050",
		slug: "bina",
		name: "Bina Gurung",
	};
	const workHtml = (
		page: unknown,
		search: WorkSearch = {},
		artists: Artist[] = [sitaWithWork(2), ARJUN],
	) =>
		renderToStaticMarkup(
			createElement(WorkPage, {
				data: workPageData(STUDIO, artists, page, search, ORIGIN, IMAGE_ORIGIN),
			}),
		);
	const form = (html: string) =>
		html.match(/<form [^>]*role="search"[\s\S]*?<\/form>/)?.[0] ?? "";
	const checkbox = (html: string) =>
		html.match(/<input type="checkbox"[^>]*>/)?.[0] ?? "";
	const dialogs = (html: string) =>
		html.match(/<dialog [^>]*>[\s\S]*?<\/dialog>/g) ?? [];
	const FACETED = galleryPage(3, {
		filters: {
			styles: [
				{ slug: "blackwork", name: "Blackwork" },
				{ slug: "fine-line", name: "Fine line" },
			],
			healed: true,
		},
	});

	test("is the studio's All work page: the site bar, the h1, the gallery, the studio", () => {
		const html = workHtml(FACETED);

		assertSafePage(html);
		assert.deepEqual(headings(html), [1, 2]);
		assert.match(html, /<h1 [^>]*>All work<\/h1>/);
		assert.match(
			html,
			/^<header class="site-bar"><a href="\/" dir="auto">Black Needle<\/a><\/header><main class="page">/,
		);
		assert.equal(count(html, /class="work-open"/g), 3);
		assert.match(html, /<footer class="site-footer">/);
		assert.ok(hrefs(html).includes("/"));
		// The studio block and the way back, as on the artist's page.
		assert.match(html, /<h2 id="studio-title"[^>]*>Black Needle<\/h2>/);
		assert.match(html, />See the studio page<\/a>/);
	});

	test("shares its site bar and studio block with the artist page, byte for byte", () => {
		const artist = artistPageData(STUDIO, [SITA], "sita", ORIGIN);
		assert.ok(artist);
		const artistHtml = renderToStaticMarkup(
			createElement(ArtistPage, { data: artist }),
		);
		const bar = (html: string) =>
			html.match(/<header class="site-bar">[\s\S]*?<\/header>/)?.[0];
		const studio = (html: string) =>
			html.match(
				/<section class="section" aria-labelledby="studio-title">[\s\S]*?<\/section>/,
			)?.[0];

		assert.ok(bar(artistHtml));
		assert.ok(studio(artistHtml));
		assert.equal(bar(workHtml(FACETED)), bar(artistHtml));
		assert.equal(studio(workHtml(FACETED)), studio(artistHtml));
	});

	test("the viewer names the artist with a link, the styles and Healed", () => {
		const [first = "", second = ""] = dialogs(workHtml(FACETED));

		assert.match(
			first,
			/<div class="work-dialog-meta"><p><a class="text-link" href="\/artists\/sita"><bdi>Sita Rai<\/bdi><\/a><\/p><p>Fine line<\/p><p>Healed<\/p><\/div>/,
		);
		// Every photo names whose it is; the second has no style and no healed mark.
		assert.match(
			second,
			/<div class="work-dialog-meta"><p><a class="text-link" href="\/artists\/sita"><bdi>Sita Rai<\/bdi><\/a><\/p><\/div>/,
		);
	});

	test("a photo with no usable artist has no link in its viewer", () => {
		const page = galleryPage(1);
		const html = workHtml({
			...page,
			data: [{ ...page.data[0], artist: null }],
		});

		assertSafePage(html);
		assert.doesNotMatch(dialogs(html)[0] ?? "", /href=/);
		assert.match(html, /alt="Tattoo, photo 1"/);
	});

	test("Show more links to the next page with the same filters", () => {
		const search: WorkSearch = {
			artist: "sita",
			style: "fine-line",
			healed: true,
		};
		const html = workHtml(galleryPage(3, { nextCursor: "c2" }), search);

		assertSafePage(html);
		assert.match(
			html,
			/<a class="action action-secondary work-more" href="\/work\?artist=sita&amp;style=fine-line&amp;healed=1&amp;cursor=c2">Show more<\/a>/,
		);
		assert.match(
			workHtml(galleryPage(3, { nextCursor: "c2" })),
			/href="\/work\?cursor=c2">Show more/,
		);
		assert.equal(count(workHtml(galleryPage(3)), /work-more/g), 0);
	});

	test("a cursor page offers the way back to the newest, keeping the filters", () => {
		const html = workHtml(galleryPage(3), {
			artist: "sita",
			healed: true,
			cursor: "c2",
		});

		assert.match(
			html,
			/<a class="text-link" href="\/work\?artist=sita&amp;healed=1">Back to the newest<\/a>/,
		);
		assert.equal(count(workHtml(galleryPage(3)), /Back to the newest/g), 0);
		assert.match(
			workHtml(galleryPage(3), { cursor: "c2" }),
			/<a class="text-link" href="\/work">Back to the newest<\/a>/,
		);
	});

	test("the filters are a GET form to /work with the artists, styles and Healed that apply", () => {
		const html = workHtml(FACETED, {}, [
			sitaWithWork(2),
			{ ...BINA, workPhotos: sitaWithWork(1).workPhotos },
			ARJUN,
		]);
		const filters = form(html);

		const tag = filters.match(/^<form [^>]*>/)?.[0] ?? "";
		assert.match(tag, / class="work-filters"/);
		assert.match(tag, / role="search"/);
		assert.match(tag, / aria-label="Filter the photos"/);
		assert.match(tag, / method="get"/);
		assert.match(tag, / action="\/work"/);
		assert.match(filters, /<label [^>]*for="work-artist"[^>]*>Artist<\/label>/);
		assert.match(
			filters,
			/<select id="work-artist" name="artist"><option value="" selected="">All artists<\/option><option value="bina">Bina Gurung<\/option><option value="sita">Sita Rai<\/option><\/select>/,
		);
		assert.match(filters, /<label [^>]*for="work-style"[^>]*>Style<\/label>/);
		assert.match(
			filters,
			/<select id="work-style" name="style"><option value="" selected="">All styles<\/option><option value="blackwork">Blackwork<\/option><option value="fine-line">Fine line<\/option><\/select>/,
		);
		assert.match(
			checkbox(filters),
			/^<input type="checkbox" name="healed" value="1"\/>$/,
		);
		assert.match(filters, />Healed only<\/span>/);
		assert.match(
			filters,
			/<button type="submit" class="action action-secondary">Show photos<\/button><\/form>$/,
		);
		assertSafePage(html);
	});

	test("the selects and the checkbox start where the address is", () => {
		const html = workHtml(
			FACETED,
			{ artist: "sita", style: "fine-line", healed: true },
			[sitaWithWork(2), { ...BINA, workPhotos: sitaWithWork(1).workPhotos }],
		);
		const filters = form(html);

		assert.match(
			filters,
			/<option value="sita" selected="">Sita Rai<\/option>/,
		);
		assert.match(
			filters,
			/<option value="fine-line" selected="">Fine line<\/option>/,
		);
		assert.match(checkbox(filters), / checked=""/);
		assert.equal(count(filters, /selected=""/g), 2);
		assert.match(filters, /<option value="bina">Bina Gurung<\/option>/);
	});

	test("shows only the filters that apply", () => {
		const one = form(workHtml(FACETED));
		// One artist with photos: nothing to choose between.
		assert.doesNotMatch(one, /name="artist"/);
		assert.match(one, /name="style"/);
		assert.match(one, /name="healed"/);

		// No facet styles: no style select.
		const noStyles = form(
			workHtml(galleryPage(3, { filters: { styles: [], healed: true } })),
		);
		assert.doesNotMatch(noStyles, /name="style"/);
		assert.match(noStyles, /name="healed"/);

		// No healed photo and not asked: no checkbox.
		const noHealed = form(
			workHtml(
				galleryPage(3, {
					filters: { styles: FACETED.filters.styles, healed: false },
				}),
			),
		);
		assert.doesNotMatch(noHealed, /name="healed"/);
		assert.match(noHealed, /name="style"/);

		// Healed asked for: the checkbox stays, to be unticked.
		const asked = form(
			workHtml(galleryPage(0, { filters: { styles: [], healed: false } }), {
				healed: true,
			}),
		);
		assert.match(checkbox(asked), / checked=""/);
	});

	test("with nothing to filter by there is no form", () => {
		const html = workHtml(
			galleryPage(3, { filters: { styles: [], healed: false } }),
		);

		assertSafePage(html);
		assert.equal(count(html, /<form [^>]*role="search"/g), 0);
		assert.equal(count(html, /<select/g), 0);
		assert.equal(count(html, /class="work-open"/g), 3);
	});

	test("with no photos it says so, and links home", () => {
		const none = galleryPage(0, { filters: { styles: [], healed: false } });
		for (const page of [none, null, { data: "x" }]) {
			const html = workHtml(page, {}, [ARJUN]);

			assertSafePage(html);
			assert.match(html, /<p[^>]*>No photos yet\.<\/p>/);
			assert.equal(count(html, /work-grid|<dialog|<form /g), 0);
			assert.ok(hrefs(html).includes("/"));
			assert.doesNotMatch(html, /No photos match/);
		}
	});

	test("with filters and no match it says so, and links to all work", () => {
		const html = workHtml(
			galleryPage(0, {
				filters: { styles: FACETED.filters.styles, healed: true },
			}),
			{ artist: "sita", style: "blackwork" },
		);

		assertSafePage(html);
		assert.match(html, /<p[^>]*>No photos match these filters\.<\/p>/);
		assert.match(html, /<a class="text-link" href="\/work">Show all work<\/a>/);
		assert.doesNotMatch(html, /No photos yet/);
		assert.equal(count(html, /work-grid|<dialog/g), 0);
		// The form is still there to change the filters.
		assert.match(form(html), /name="style"/);
	});

	test("a hostile artist, style or description is text, never markup", () => {
		const page = galleryPage(1);
		const html = workHtml(
			{
				...page,
				data: [
					{
						...page.data[0],
						alt: '"><script>alert(1)</script>',
						styles: [{ slug: "a", name: "<b>x</b>" }],
						artist: { slug: "sita", name: "<i>Sita</i>" },
					},
				],
				filters: {
					healed: false,
					styles: [{ slug: "a", name: "<u>y</u>" }],
				},
			},
			{},
			[{ ...sitaWithWork(1), name: "<s>Sita</s>" }],
		);

		assertSafePage(html);
		assert.doesNotMatch(html, /<script>alert|<b>x|<i>Sita|<u>y|<s>Sita/);
	});
});

describe("an artist's styles and links", () => {
	/** An artist who sets styles and links, shown on the studio page and on their own. */
	const THREE_STYLES: Artist = {
		...SITA,
		styles: [
			{ slug: "japanese", name: "Japanese" },
			{ slug: "blackwork", name: "Blackwork" },
			{ slug: "cover-up", name: "Cover-up" },
		],
		socialLinks: [
			{ platform: "instagram", url: "https://instagram.com/sita.ink" },
			{ platform: "facebook", url: "https://facebook.com/sita.ink" },
			{ platform: "tiktok", url: "https://www.tiktok.com/@sita.ink" },
		],
	};
	const pageOf = (artist: Artist) => {
		const data = artistPageData(STUDIO, [artist], artist.slug, ORIGIN);
		assert.ok(data);
		return renderToStaticMarkup(createElement(ArtistPage, { data }));
	};
	const STYLES_LINE = /<p class="artist-styles">([^<]*)<\/p>/;
	const STYLE_LIST =
		/<ul class="style-list" aria-label="Styles">([\s\S]*?)<\/ul>/;
	const ARTIST_LINKS =
		/<ul class="artist-links" aria-label="Links">([\s\S]*?)<\/ul>/;

	test("the card shows the artist's styles on one line", () => {
		const html = studioHtml(STUDIO, [THREE_STYLES, ARJUN]);

		assertSafePage(html);
		assert.equal(count(html, /class="artist-styles"/g), 1);
		assert.equal(
			html.match(STYLES_LINE)?.[1],
			"Japanese · Blackwork · Cover-up",
		);
		// Under the name, in the card's head.
		assert.match(
			html,
			/<h3 id="artist-sita" class="artist-name" dir="auto">Sita Rai<\/h3><p class="artist-styles">/,
		);
		// Styles are on the card alone: the roster has no chips or links.
		assert.equal(count(html, /class="style-list"|class="artist-links"/g), 0);
	});

	test("the artist page shows styles and links", () => {
		const html = pageOf(SITA);

		assertSafePage(html);
		const styles = html.match(STYLE_LIST)?.[1];
		assert.ok(styles);
		assert.deepEqual(
			Array.from(styles.matchAll(/<li>([^<]*)<\/li>/g), (m) => m[1]),
			["Fine line"],
		);
		const links = html.match(ARTIST_LINKS)?.[1];
		assert.ok(links);
		assert.match(
			links,
			/<a class="link-chip" href="https:\/\/instagram\.com\/sita\.ink" rel="noopener noreferrer">Instagram<\/a>/,
		);
		assert.equal(count(links, /<li>/g), 1);
		// The card's one-line version is not repeated on the artist's own page.
		assert.equal(count(html, /class="artist-styles"/g), 0);
	});

	test("the artist page's two lists are named Styles and Links", () => {
		const html = pageOf(THREE_STYLES);

		assert.equal(
			count(html, /<ul class="style-list" aria-label="Styles">/g),
			1,
		);
		assert.equal(
			count(html, /<ul class="artist-links" aria-label="Links">/g),
			1,
		);
	});

	test("the artist page lists every style as a chip, and every link in Instagram, Facebook, TikTok order", () => {
		const html = pageOf(THREE_STYLES);

		assertSafePage(html);
		assert.deepEqual(
			Array.from(
				(html.match(STYLE_LIST)?.[1] ?? "").matchAll(/<li>([^<]*)<\/li>/g),
				(m) => m[1],
			),
			["Japanese", "Blackwork", "Cover-up"],
		);
		assert.deepEqual(
			Array.from(
				(html.match(ARTIST_LINKS)?.[1] ?? "").matchAll(
					/<a [^>]*>([^<]*)<\/a>/g,
				),
				(m) => m[1],
			),
			["Instagram", "Facebook", "TikTok"],
		);
	});

	test("the page puts the styles under the title and the links after the bio", () => {
		const html = pageOf(THREE_STYLES);
		const at = (pattern: RegExp) => html.search(pattern);

		assert.ok(at(/<h1 /) < at(/class="style-list"/));
		assert.ok(at(/class="style-list"/) < at(/Fine line florals/));
		assert.ok(at(/Fine line florals/) < at(/class="artist-links"/));
		assert.ok(at(/class="artist-links"/) < at(/id="inquiry"/));
	});

	test("an artist with no styles or links shows neither", () => {
		const roster = studioHtml(STUDIO, [ARJUN]);
		const page = pageOf(ARJUN);

		assert.equal(count(roster, /artist-styles/g), 0);
		for (const html of [roster, page]) {
			assert.equal(count(html, /artist-styles|style-list|artist-links/g), 0);
		}
	});

	test("an artist saved before this feature (an empty object, null) shows neither", () => {
		const old = {
			...SITA,
			styles: {},
			socialLinks: null,
		} as unknown as Artist;
		for (const html of [studioHtml(STUDIO, [old]), pageOf(old)]) {
			assert.equal(count(html, /artist-styles|style-list|artist-links/g), 0);
		}
	});

	test("a link that is not https never reaches the page, and a list left empty is not drawn", () => {
		const hostile = {
			...SITA,
			socialLinks: [
				{ platform: "instagram", url: "javascript:alert(1)" },
				{ platform: "facebook", url: "http://facebook.com/sita" },
			],
		} as unknown as Artist;
		const html = pageOf(hostile);

		assertSafePage(html);
		assert.equal(count(html, /artist-links/g), 0);
	});

	test("hostile style text stays text", () => {
		const hostile = {
			...SITA,
			styles: [{ slug: "x", name: "<script>alert(1)</script>" }],
		} as unknown as Artist;

		for (const html of [studioHtml(STUDIO, [hostile]), pageOf(hostile)]) {
			assertSafePage(html);
			assert.doesNotMatch(html, /<script>alert/);
			assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
		}
	});
});
