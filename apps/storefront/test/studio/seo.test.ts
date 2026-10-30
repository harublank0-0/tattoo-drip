import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { flashDesignView } from "../../src/studio/flash.ts";
import {
	artistPageSeo,
	flashDesignSeo,
	flashPageSeo,
	headTags,
	requestPageSeo,
	serializeJsonLd,
	statusHead,
	studioPageSeo,
	workPageSeo,
} from "../../src/studio/seo.ts";
import {
	artistViewModels,
	studioViewModel,
} from "../../src/studio/view-model.ts";
import {
	ARJUN,
	EMPTY_STUDIO,
	flashId,
	flashPage,
	ORIGIN,
	SITA,
	STUDIO,
} from "./fixtures.ts";

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

describe("requestPageSeo (TAT-127)", () => {
	test("the general request page asks for the idea and names the studio", () => {
		const seo = requestPageSeo(studio, null, ORIGIN, true);

		assert.equal(seo.title, "Send your idea to Black Needle");
		assert.equal(
			seo.description,
			"Tell Black Needle about the tattoo you'd like: the idea, where it goes and the dates that suit you.",
		);
		assert.equal(seo.canonical, `${ORIGIN}/request`);
		assert.equal(seo.type, "website");
		assert.equal(seo.siteName, "Black Needle");
		assert.equal(seo.image, null);
		assert.equal(seo.jsonLd, null);
	});

	test("with an artist, the title and description name them, and the artist stays in the canonical address", () => {
		const seo = requestPageSeo(studio, sita, ORIGIN, true);

		assert.equal(seo.title, "Send your idea to Sita Rai at Black Needle");
		assert.equal(
			seo.description,
			"Tell Sita Rai about the tattoo you'd like: the idea, where it goes and the dates that suit you.",
		);
		// Facebook keys a shared link by its canonical og:url.
		assert.equal(seo.canonical, `${ORIGIN}/request?artist=sita`);
		assert.deepEqual(seo.image, sita.photo);
		assert.equal(seo.jsonLd, null);
	});

	test("an independent artist named like their studio isn't named twice", () => {
		const [same] = artistViewModels([{ ...SITA, name: "Black Needle" }]);
		const seo = requestPageSeo(studio, same, ORIGIN, true);

		assert.equal(seo.title, "Send your idea to Black Needle");
	});

	test("a closed artist's page does not invite: the title and description say what the page says", () => {
		const seo = requestPageSeo(studio, arjun, ORIGIN, false);

		assert.equal(seo.title, "Inquiries for अर्जुन थापा at Black Needle");
		assert.equal(
			seo.description,
			"अर्जुन थापा isn't taking new inquiries right now.",
		);
		// The address is the same as an open page's: the artist stays in it.
		assert.equal(seo.canonical, `${ORIGIN}/request?artist=arjun`);
		assert.doesNotMatch(
			`${seo.title} ${seo.description}`,
			/Send your idea|Tell /,
		);
	});

	test("a closed studio's general page does not invite either", () => {
		const seo = requestPageSeo(studio, null, ORIGIN, false);

		assert.equal(seo.title, "Inquiries at Black Needle");
		assert.equal(
			seo.description,
			"Black Needle isn't taking new inquiries right now.",
		);
		assert.equal(seo.canonical, `${ORIGIN}/request`);
		assert.equal(seo.image, null);
	});

	test("a closed artist named like their studio is named once", () => {
		const [same] = artistViewModels([{ ...ARJUN, name: "Black Needle" }]);
		const seo = requestPageSeo(studio, same, ORIGIN, false);

		assert.equal(seo.title, "Inquiries at Black Needle");
		assert.equal(
			seo.description,
			"Black Needle isn't taking new inquiries right now.",
		);
	});

	// `open` has no default: a caller that forgets it fails typecheck instead of inviting.
	test("an open page keeps its inviting title, and a closed one differs from it", () => {
		assert.equal(
			requestPageSeo(studio, sita, ORIGIN, true).title,
			"Send your idea to Sita Rai at Black Needle",
		);
		assert.notDeepEqual(
			requestPageSeo(studio, sita, ORIGIN, true),
			requestPageSeo(studio, sita, ORIGIN, false),
		);
	});

	test("writes its head like the other pages, with the artist's photo for the card", () => {
		const head = headTags(requestPageSeo(studio, sita, ORIGIN, true));

		assert.deepEqual(head.scripts, []);
		assert.deepEqual(head.links, [
			{ rel: "canonical", href: `${ORIGIN}/request?artist=sita` },
		]);
		assert.ok(
			head.meta.some(
				(m) =>
					"property" in m &&
					m.property === "og:url" &&
					m.content === `${ORIGIN}/request?artist=sita`,
			),
		);
		assert.ok(
			head.meta.some((m) => "property" in m && m.property === "og:image"),
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

describe("the flash pages' heads (TAT-129)", () => {
	const moth = (over: object = {}) => {
		const view = flashDesignView(
			{ ...flashPage(1).data[0], ...over },
			"https://api.example.com",
		);
		assert.ok(view);
		return view;
	};

	test("flashPageSeo: one canonical address whatever the filter, no image, no JSON-LD", () => {
		const seo = flashPageSeo(studio, ORIGIN);

		assert.equal(seo.title, "Flash at Black Needle");
		assert.equal(
			seo.description,
			"Flash designs by the artists of Black Needle: pick one and ask for it.",
		);
		assert.equal(seo.canonical, `${ORIGIN}/flash`);
		assert.equal(seo.image, null);
		assert.equal(seo.jsonLd, null);
		const alone = flashPageSeo(
			studioViewModel({ ...STUDIO, type: "independent" }),
			ORIGIN,
		);
		assert.equal(alone.title, "Flash by Black Needle");
		assert.equal(
			alone.description,
			"Flash designs by Black Needle: pick one and ask for it.",
		);
	});

	test("flashDesignSeo names the design and its artist, and says how to ask", () => {
		const seo = flashDesignSeo(studio, moth(), ORIGIN);

		assert.equal(seo.title, "Moth, flash by Sita Rai at Black Needle");
		assert.equal(
			seo.description,
			"A flash design by Sita Rai, About 3 in, NPR 3,000. Ask Black Needle for it.",
		);
		assert.equal(seo.canonical, `${ORIGIN}/flash/${flashId(1)}`);
		assert.equal(seo.image, null);
		assert.equal(seo.jsonLd, null);
	});

	test("one name when the studio is named like the artist; no price, no artist", () => {
		const same = studioViewModel({ ...STUDIO, name: "Sita Rai" });
		assert.equal(
			flashDesignSeo(same, moth(), ORIGIN).title,
			"Moth, flash by Sita Rai",
		);
		const cheap = flashDesignSeo(studio, moth({ price: null }), ORIGIN);
		assert.equal(
			cheap.description,
			"A flash design by Sita Rai, About 3 in. Ask Black Needle for it.",
		);
		const nobody = flashDesignSeo(
			studio,
			moth({ artist: { slug: "Bad", name: "x" } }),
			ORIGIN,
		);
		assert.equal(nobody.title, "Moth, flash at Black Needle");
		assert.equal(
			nobody.description,
			"A flash design, About 3 in, NPR 3,000. Ask Black Needle for it.",
		);
	});

	test("a long description is trimmed like the others", () => {
		const long = flashDesignSeo(
			studio,
			moth({ size: "x".repeat(60), price: null }),
			ORIGIN,
		);
		assert.ok(long.description.length <= 160);
	});
});

describe("requestPageSeo for a flash design (TAT-129)", () => {
	const moth = flashDesignView(flashPage(1).data[0], "https://api.example.com");

	test("names the design and its artist, with its own canonical address and no image", () => {
		assert.ok(moth);
		const seo = requestPageSeo(studio, sita, ORIGIN, true, moth);

		assert.equal(seo.title, "Ask for the Moth flash at Black Needle");
		assert.equal(
			seo.description,
			"Ask Black Needle for the Moth flash by Sita Rai: say where it goes and the dates that suit you.",
		);
		assert.equal(seo.canonical, `${ORIGIN}/request?flash=${flashId(1)}`);
		assert.equal(seo.image, null);
		assert.equal(seo.jsonLd, null);
	});

	test("without a design TAT-127's results stand", () => {
		assert.deepEqual(
			requestPageSeo(studio, sita, ORIGIN, true, null),
			requestPageSeo(studio, sita, ORIGIN, true),
		);
		assert.equal(
			requestPageSeo(studio, sita, ORIGIN, true).canonical,
			`${ORIGIN}/request?artist=sita`,
		);
	});
});
