import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { crumbs } from "../src/lib/breadcrumbs.ts";
import {
	artistLd,
	artworkLd,
	breadcrumbLd,
	jsonLdOf,
	organizationLd,
	structuredData,
	studioLd,
	websiteLd,
} from "../src/lib/structured-data.ts";

const ON = { siteUrl: "https://tattoodrip.app", indexing: true };
const OFF = { ...ON, indexing: false };
const KATHMANDU = {
	country: "NP",
	slug: "kathmandu",
	name: "Kathmandu",
	region: "Bagmati",
};
const image = (url: string) => ({
	url,
	width: 1200,
	height: 1500,
	variants: [],
});

const studio = {
	id: "s1",
	slug: "black-needle",
	name: "Black Needle",
	type: "studio",
	location: KATHMANDU,
	logo: {
		...image("https://media.test/logo.png"),
		alt: null,
		tile: "light",
		icon: null,
	},
	cover: { ...image("https://media.test/cover.jpg"), alt: null },
	styles: [{ slug: "blackwork", name: "Blackwork" }],
	storefrontUrl: "https://black-needle.example/",
	intro: "We tattoo.",
	timezone: "Asia/Kathmandu",
	socialLinks: [
		{ platform: "instagram", url: "https://instagram.com/black.needle" },
		{ platform: "website", url: "javascript:alert(1)" },
		{ platform: "facebook", url: "http://facebook.com/plain-http" },
	],
	artists: [],
	tattoos: [],
	bookingUrl: "https://black-needle.example/book?ref=a.b",
} as never;

const artist = (independent: boolean) =>
	({
		id: "a1",
		slug: "sita",
		name: "Sita Rai",
		photo: image("https://media.test/sita.jpg"),
		styles: [],
		acceptingInquiries: true,
		independent,
		studio: independent
			? { slug: "sita-solo", name: "Sita Solo", type: "independent" }
			: { slug: "black-needle", name: "Black Needle", type: "studio" },
		location: KATHMANDU,
		storefrontUrl: "https://black-needle.example/artists/sita",
		bio: "Bio.",
		socialLinks: [{ platform: "instagram", url: "https://instagram.com/sita" }],
		tattoos: [],
		bookingUrl: "https://black-needle.example/book?artist=sita&ref=a.b",
	}) as never;

const ID = "0b6f8e2c-6a4a-4f1e-9a51-1b0c2d3e4f50";
const tattoo = {
	id: ID,
	image: {
		...image("https://media.test/koi.jpg"),
		alt: "Koi <script>x</script>",
	},
	styles: [{ slug: "blackwork", name: "Blackwork" }],
	healed: false,
	artist: { id: "a1", slug: "sita", name: "Sita Rai" },
	studio: { slug: "black-needle", name: "Black Needle", type: "studio" },
	location: KATHMANDU,
	artistAcceptingInquiries: true,
	storefrontUrl: `https://black-needle.example/gallery/${ID}`,
	bookingUrl: `https://black-needle.example/book?artwork=${ID}&ref=a.b`,
} as never;

/** No key of a node anywhere names a private or invented field. */
function assertNoPrivateFields(node: unknown) {
	const text = JSON.stringify(node);
	for (const word of [
		"aggregateRating",
		"review",
		"priceRange",
		"openingHours",
		"telephone",
		"email",
		"streetAddress",
		"bookingUrl",
		"ref=",
		"timezone",
	])
		assert.doesNotMatch(text, new RegExp(word, "i"), word);
}

describe("structured data (D10)", () => {
	test("home: WebSite (with the studio search as its SearchAction) and Organization", () => {
		const site = websiteLd(ON);
		assert.equal(site["@type"], "WebSite");
		assert.equal(site.url, "https://tattoodrip.app/");
		assert.deepEqual(site.potentialAction, {
			"@type": "SearchAction",
			target: {
				"@type": "EntryPoint",
				urlTemplate:
					"https://tattoodrip.app/explore/studios?q={search_term_string}",
			},
			"query-input": "required name=search_term_string",
		});
		const org = organizationLd(ON);
		assert.equal(org.name, "Tattoo Drip");
		assert.deepEqual(org.logo, {
			"@type": "ImageObject",
			url: "https://tattoodrip.app/brand/tattoo-drip-512.png",
			width: 512,
			height: 512,
		});
	});

	test("a studio: a TattooParlor at its Discover address, locality and country only, https socials only", () => {
		const node = studioLd(ON, studio);
		assert.deepEqual(node, {
			"@type": "TattooParlor",
			"@id": "https://tattoodrip.app/studios/black-needle#studio",
			name: "Black Needle",
			url: "https://tattoodrip.app/studios/black-needle",
			image: "https://media.test/cover.jpg",
			logo: "https://media.test/logo.png",
			address: {
				"@type": "PostalAddress",
				addressLocality: "Kathmandu",
				addressRegion: "Bagmati",
				addressCountry: "NP",
			},
			sameAs: ["https://instagram.com/black.needle"],
		});
		assertNoPrivateFields(node);
	});

	test("an artist: a Person working for their studio; an independent works for no one", () => {
		const atStudio = artistLd(ON, artist(false));
		assert.equal(atStudio["@type"], "Person");
		assert.equal(
			atStudio.url,
			"https://tattoodrip.app/studios/black-needle/artists/sita",
		);
		assert.deepEqual(atStudio.worksFor, {
			"@type": "TattooParlor",
			"@id": "https://tattoodrip.app/studios/black-needle#studio",
			name: "Black Needle",
			url: "https://tattoodrip.app/studios/black-needle",
		});
		assert.equal(atStudio.image, "https://media.test/sita.jpg");
		assert.deepEqual(atStudio.sameAs, ["https://instagram.com/sita"]);
		const solo = artistLd(ON, artist(true));
		assert.equal(solo.url, "https://tattoodrip.app/artists/sita-solo");
		assert.equal("worksFor" in solo, false);
		assertNoPrivateFields(atStudio);
	});

	test("an artwork: an ImageObject with its size, caption and creator", () => {
		const node = artworkLd(ON, tattoo, "Koi");
		assert.deepEqual(node, {
			"@type": "ImageObject",
			"@id": `https://tattoodrip.app/tattoos/${ID}#image`,
			url: `https://tattoodrip.app/tattoos/${ID}`,
			contentUrl: "https://media.test/koi.jpg",
			width: 1200,
			height: 1500,
			name: "Koi",
			caption: "Koi <script>x</script>",
			creator: {
				"@type": "Person",
				name: "Sita Rai",
				url: "https://tattoodrip.app/studios/black-needle/artists/sita",
			},
		});
		assertNoPrivateFields(node);
	});

	test("breadcrumbs: the visible list, in order, every item an absolute URL", () => {
		const list = breadcrumbLd(
			ON,
			crumbs.artist(artist(false)),
			"/studios/black-needle/artists/sita",
		);
		assert.deepEqual(list.itemListElement, [
			{
				"@type": "ListItem",
				position: 1,
				name: "Discover",
				item: "https://tattoodrip.app/",
			},
			{
				"@type": "ListItem",
				position: 2,
				name: "Studios",
				item: "https://tattoodrip.app/explore/studios",
			},
			{
				"@type": "ListItem",
				position: 3,
				name: "Black Needle",
				item: "https://tattoodrip.app/studios/black-needle",
			},
			{
				"@type": "ListItem",
				position: 4,
				name: "Sita Rai",
				item: "https://tattoodrip.app/studios/black-needle/artists/sita",
			},
		]);
	});

	test("one script, only on an indexable page", () => {
		const head = (
			settings: typeof ON,
			over: Record<string, unknown> = {},
			pathname = "/studios/black-needle",
		) => ({
			match: { context: { discover: { settings } } },
			matches: [
				{ routeId: "__root__", status: "success", pathname: "/", search: {} },
				{
					routeId: "/studios/$studioSlug/",
					status: "success",
					pathname,
					search: { country: undefined },
					...over,
				},
			],
		});
		const nodes = [studioLd(ON, studio)];
		const [entry, ...rest] = structuredData(head(ON), nodes);
		assert.equal(rest.length, 0);
		assert.deepEqual(jsonLdOf(entry), {
			"@context": "https://schema.org",
			"@graph": nodes,
		});
		// Never while indexing is off, on a variant, a 404, an error or an opt-out.
		assert.deepEqual(structuredData(head(OFF), nodes), []);
		assert.deepEqual(
			structuredData(head(ON, { search: { country: "IN" } }), nodes),
			[],
		);
		assert.deepEqual(
			structuredData(head(ON, { status: "notFound" }), nodes),
			[],
		);
		assert.deepEqual(structuredData(head(ON, { status: "error" }), nodes), []);
		assert.deepEqual(
			structuredData(head(ON, { loaderData: { noindex: true } }), nodes),
			[],
		);
		assert.deepEqual(structuredData(head(ON, {}, "/pricing"), nodes), []);
	});
});
