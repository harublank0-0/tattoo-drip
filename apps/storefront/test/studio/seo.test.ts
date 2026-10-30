import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	artistPageSeo,
	headTags,
	serializeJsonLd,
	statusHead,
	studioPageSeo,
	workPageSeo,
} from "../../src/studio/seo.ts";
import {
	artistViewModels,
	studioViewModel,
} from "../../src/studio/view-model.ts";
import { ARJUN, EMPTY_STUDIO, ORIGIN, SITA, STUDIO } from "./fixtures.ts";

const studio = studioViewModel(STUDIO);
const empty = studioViewModel(EMPTY_STUDIO);
const [sita, arjun] = artistViewModels([SITA, ARJUN]);

describe("studioPageSeo", () => {
	test("titles the page with the studio and describes it with its intro", () => {
		const seo = studioPageSeo(studio, [sita, arjun], ORIGIN);

		assert.equal(seo.title, "Black Needle");
		assert.equal(
			seo.description,
			"Fine line and blackwork in Thamel. Walk-ins on Sundays.",
		);
		assert.equal(seo.canonical, `${ORIGIN}/`);
		assert.equal(seo.type, "website");
		assert.equal(seo.siteName, "Black Needle");
		assert.equal(seo.image, null);
	});

	test("without an intro, a fixed sentence", () => {
		assert.equal(
			studioPageSeo(empty, [], ORIGIN).description,
			"Black Needle, tattoo studio. See the artists and send an inquiry.",
		);
		assert.equal(
			studioPageSeo(
				studioViewModel({ ...EMPTY_STUDIO, type: "independent" }),
				[],
				ORIGIN,
			).description,
			"Black Needle, independent tattoo artist. Send an inquiry.",
		);
	});

	test("shares the photo of a studio's only artist, and no one else's", () => {
		assert.deepEqual(studioPageSeo(studio, [sita], ORIGIN).image, sita.photo);
		assert.equal(studioPageSeo(studio, [arjun], ORIGIN).image, null);
		assert.equal(studioPageSeo(studio, [sita, arjun], ORIGIN).image, null);
	});
});

describe("the studio's JSON-LD", () => {
	test("says only what the page shows", () => {
		assert.deepEqual(studioPageSeo(studio, [sita, arjun], ORIGIN).jsonLd, {
			"@context": "https://schema.org",
			"@type": "TattooParlor",
			name: "Black Needle",
			url: `${ORIGIN}/`,
			description: "Fine line and blackwork in Thamel. Walk-ins on Sundays.",
			telephone: "+9779812345678",
			email: "hello@black-needle.example",
			address: "Thamel Marg, Kathmandu",
			sameAs: [
				"https://instagram.com/blackneedle",
				"https://facebook.com/blackneedle",
				"https://www.tiktok.com/@blackneedle",
				"https://black-needle.example/",
			],
		});
	});

	test("leaves out what the studio hasn't set, and names the only artist's photo", () => {
		assert.deepEqual(studioPageSeo(empty, [], ORIGIN).jsonLd, {
			"@context": "https://schema.org",
			"@type": "TattooParlor",
			name: "Black Needle",
			url: `${ORIGIN}/`,
			description:
				"Black Needle, tattoo studio. See the artists and send an inquiry.",
		});
		assert.equal(
			studioPageSeo(empty, [sita], ORIGIN).jsonLd?.image,
			sita.photo?.src,
		);
	});
});

describe("artistPageSeo", () => {
	test("titles the page with the artist at the studio", () => {
		const seo = artistPageSeo(studio, sita, ORIGIN);

		assert.equal(seo.title, "Sita Rai at Black Needle");
		assert.equal(seo.description, "Fine line florals. Books a month ahead.");
		assert.equal(seo.canonical, `${ORIGIN}/artists/sita`);
		assert.equal(seo.type, "profile");
		assert.deepEqual(seo.image, sita.photo);
		assert.equal(seo.jsonLd, null);
	});

	test("without a bio or a photo, a fixed sentence and no image", () => {
		const seo = artistPageSeo(studio, arjun, ORIGIN);

		assert.equal(
			seo.description,
			"अर्जुन थापा is a tattoo artist at Black Needle. Send an inquiry.",
		);
		assert.equal(seo.image, null);
	});

	test("an independent artist named like their studio isn't named twice", () => {
		const [same] = artistViewModels([{ ...ARJUN, name: "Black Needle" }]);
		const seo = artistPageSeo(studio, same, ORIGIN);

		assert.equal(seo.title, "Black Needle");
		assert.equal(
			seo.description,
			"Black Needle is a tattoo artist. Send an inquiry.",
		);
	});
});

describe("workPageSeo (TAT-126)", () => {
	test("titles the page with the studio and says what it shows", () => {
		const seo = workPageSeo(studio, ORIGIN);

		assert.equal(seo.title, "All work at Black Needle");
		assert.equal(
			seo.description,
			"Tattoos by the artists of Black Needle, newest first.",
		);
		assert.equal(seo.canonical, `${ORIGIN}/work`);
		assert.equal(seo.type, "website");
		assert.equal(seo.siteName, "Black Needle");
		assert.equal(seo.image, null);
		assert.equal(seo.jsonLd, null);
	});

	test("an independent studio's work is its artist's", () => {
		const alone = studioViewModel({
			...STUDIO,
			name: "Sita Rai",
			type: "independent",
		});
		const seo = workPageSeo(alone, ORIGIN);

		assert.equal(seo.title, "All work by Sita Rai");
		assert.equal(seo.description, "Tattoos by Sita Rai, newest first.");
	});

	test("the canonical address is /work whatever the filters or page", () => {
		// The head takes the studio and the origin alone, never the address's search.
		assert.equal(workPageSeo.length, 2);
		assert.equal(workPageSeo(studio, ORIGIN).canonical, `${ORIGIN}/work`);
	});

	test("writes its head like the other pages, with no image card and no JSON-LD", () => {
		const head = headTags(workPageSeo(studio, ORIGIN));

		assert.deepEqual(head.scripts, []);
		assert.deepEqual(head.links, [
			{ rel: "canonical", href: `${ORIGIN}/work` },
		]);
		assert.ok(
			head.meta.some(
				(m) => "title" in m && m.title === "All work at Black Needle",
			),
		);
		assert.ok(
			head.meta.some(
				(m) =>
					"name" in m && m.name === "twitter:card" && m.content === "summary",
			),
		);
		assert.ok(
			!head.meta.some((m) => "property" in m && m.property === "og:image"),
		);
	});
});

describe("serializeJsonLd", () => {
	test("can't close the script element it sits in", () => {
		const value = {
			name: "</script><script>alert(1)</script> &\u2028\u2029",
		};
		const out = serializeJsonLd(value);

		assert.doesNotMatch(out, /[<>&\u2028\u2029]/);
		assert.deepEqual(JSON.parse(out), value);
	});
});

describe("headTags", () => {
	test("writes the title, description, canonical and Open Graph tags", () => {
		assert.deepEqual(headTags(artistPageSeo(studio, sita, ORIGIN)), {
			meta: [
				{ title: "Sita Rai at Black Needle" },
				{
					name: "description",
					content: "Fine line florals. Books a month ahead.",
				},
				{ property: "og:type", content: "profile" },
				{ property: "og:site_name", content: "Black Needle" },
				{ property: "og:title", content: "Sita Rai at Black Needle" },
				{
					property: "og:description",
					content: "Fine line florals. Books a month ahead.",
				},
				{ property: "og:url", content: `${ORIGIN}/artists/sita` },
				{ property: "og:image", content: sita.photo?.src },
				{ property: "og:image:width", content: "1200" },
				{ property: "og:image:height", content: "1500" },
				{ property: "og:image:alt", content: "Photo of Sita Rai" },
				{ name: "twitter:card", content: "summary_large_image" },
			],
			links: [{ rel: "canonical", href: `${ORIGIN}/artists/sita` }],
			scripts: [],
		});
	});

	test("a page without an image is a summary card, and the studio's JSON-LD is one script", () => {
		const seo = studioPageSeo(studio, [sita, arjun], ORIGIN);
		const tags = headTags(seo);

		assert.deepEqual(tags.meta.at(-1), {
			name: "twitter:card",
			content: "summary",
		});
		assert.ok(
			!tags.meta.some(
				(tag) => "property" in tag && tag.property === "og:image",
			),
		);
		assert.equal(tags.scripts.length, 1);
		assert.equal(tags.scripts[0].type, "application/ld+json");
		assert.deepEqual(JSON.parse(tags.scripts[0].children), seo.jsonLd);
	});
});

describe("statusHead", () => {
	test("a not-found or error page is never indexed", () => {
		assert.deepEqual(statusHead("notFound"), {
			meta: [
				{ title: "Page not found" },
				{ name: "robots", content: "noindex" },
			],
			links: [],
			scripts: [],
		});
		assert.deepEqual(statusHead("error").meta, [
			{ title: "Please try again" },
			{ name: "robots", content: "noindex" },
		]);
	});
});
