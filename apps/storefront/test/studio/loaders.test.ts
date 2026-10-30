import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { isNotFound } from "@tanstack/react-router";
import { type Artist, type Studio, TattooApiError } from "@tattoo-drip/sdk";
import {
	connectServer,
	createApiContext,
	seedStudio,
} from "../../src/api/context.ts";
import { SiteRef } from "../../src/site/context.ts";
import { EMPTY_GALLERY } from "../../src/studio/gallery.ts";
import {
	artistPageData,
	loadArtistPage,
	loadStudioPage,
	loadWorkPage,
	moreWork,
	studioPageData,
	workPageData,
} from "../../src/studio/loaders.ts";
import { fakeFetch, json } from "../tenancy/helpers.ts";
import {
	ARJUN,
	CLOSED_STUDIO,
	galleryPage,
	ORIGIN,
	SITA,
	STUDIO,
	sitaWithWork,
} from "./fixtures.ts";
import { IMAGE_ORIGIN } from "./theme-fixtures.ts";

const API = "http://api.test";
const NOT_FOUND = { error: { code: "not_found", message: "Not found." } };
const notFound = (error: unknown) => isNotFound(error);

/** A server render's context, as getRouter() builds it: studio seeded, origin set. */
function pageContext(
	fetch: typeof globalThis.fetch,
	studio: Studio = STUDIO,
	apiUrl: string = API,
) {
	const api = createApiContext("server");
	connectServer(api, { config: { apiUrl }, studio, fetch });
	seedStudio(api, studio);
	const site = new SiteRef();
	site.connect(ORIGIN);
	return { ...api, site };
}

/** The gallery read with no photo in it. */
const EMPTY_PAGE = {
	data: [],
	nextCursor: null,
	filters: { styles: [], healed: false },
};

/** An API that lists `artists`, answers the gallery read with `work` and knows nothing else. */
function listing(
	artists: Artist[] = [SITA, ARJUN],
	work: unknown = EMPTY_PAGE,
) {
	return fakeFetch(({ url }) => {
		if (url.endsWith("/artists")) return json(200, { data: artists });
		if (url.includes("/work?")) return json(200, work);
		return json(404, NOT_FOUND);
	});
}

const VALIDATION_FAILED = {
	error: {
		code: "validation_failed",
		message: "The request is not valid.",
		fields: { cursor: ["That is not a cursor from this list."] },
	},
};

describe("loadStudioPage", () => {
	test("reads the artists once and the studio from the cache", async () => {
		const { calls, fetch } = listing();
		const context = pageContext(fetch);

		assert.deepEqual(
			await loadStudioPage(context),
			studioPageData(STUDIO, [SITA, ARJUN], ORIGIN),
		);
		await loadStudioPage(context);
		assert.deepEqual(
			calls.map((call) => call.url),
			[`${API}/api/v1/tenants/${STUDIO.slug}/artists`],
		);
	});

	test("a closed studio's page takes no inquiry", async () => {
		const { fetch } = listing([ARJUN]);
		const data = await loadStudioPage(pageContext(fetch, CLOSED_STUDIO));

		assert.equal(data.studio.accepting, false);
		assert.equal(data.inquiry.kind, "studio-closed");
	});

	test("the API failing is an error, not a not-found", async () => {
		for (const respond of [
			() => json(500, { error: { code: "internal_error", message: "Boom." } }),
			() =>
				new Response("<h1>Bad gateway</h1>", {
					status: 502,
					headers: { "content-type": "text/html" },
				}),
		]) {
			const { fetch } = fakeFetch(respond);
			await assert.rejects(
				loadStudioPage(pageContext(fetch)),
				(error: unknown) =>
					error instanceof TattooApiError && !isNotFound(error),
			);
		}
	});

	test("the list's own not_found (the studio went away) is a not-found", async () => {
		const { fetch } = fakeFetch(() => json(404, NOT_FOUND));
		await assert.rejects(loadStudioPage(pageContext(fetch)), notFound);
	});
});

describe("loadArtistPage", () => {
	test("finds a visible artist by exact slug", async () => {
		const { fetch } = listing();
		const data = await loadArtistPage(pageContext(fetch), "sita", {});

		assert.deepEqual(
			data,
			artistPageData(STUDIO, [SITA, ARJUN], "sita", ORIGIN),
		);
		assert.equal(data.artist.name, "Sita Rai");
		assert.equal(data.seo.canonical, `${ORIGIN}/artists/sita`);
		assert.equal(data.inquiry.kind, "open");
	});

	test("an unknown, hidden or renamed artist is a not-found", async () => {
		// Hidden and deleted artists, and old slugs, aren't in the list the API sends.
		const { fetch } = listing();
		for (const slug of ["nobody", "mira", "sita-old"]) {
			await assert.rejects(
				loadArtistPage(pageContext(fetch), slug, {}),
				notFound,
				slug,
			);
		}
	});

	test("a slug that can't be an artist's is a not-found without asking the API", async () => {
		const { calls, fetch } = listing();
		for (const slug of [
			"Sita",
			"sita ",
			"../admin",
			"sita/",
			"s",
			"-sita",
			"x".repeat(64),
			"",
		]) {
			await assert.rejects(
				loadArtistPage(pageContext(fetch), slug, {}),
				notFound,
				JSON.stringify(slug),
			);
		}
		assert.equal(calls.length, 0);
	});

	test("a closed artist's page points to the studio", async () => {
		const { fetch } = listing();
		const data = await loadArtistPage(pageContext(fetch), "arjun", {});

		assert.deepEqual(data.inquiry, {
			kind: "artist-closed",
			studioName: "Black Needle",
			artistName: "अर्जुन थापा",
			studioOpen: true,
		});
	});
});

describe("the loaders' work photos (TAT-116)", () => {
	const work = (origin: string) => ({
		url: `${origin}/uploads/tenants/t/artist_work_photo/w.jpg`,
		width: 1200,
		height: 900,
		alt: "Koi on the forearm",
		variants: [],
	});

	test("both pages show work photos served from the API's own origin", async () => {
		const sita = { ...SITA, workPhotos: [work(API)] };
		const { fetch } = listing([sita, ARJUN]);

		const studio = await loadStudioPage(pageContext(fetch));
		const artist = await loadArtistPage(pageContext(fetch), "sita", {});

		assert.equal(studio.artists[0].workPhotos.length, 1);
		assert.equal(studio.artists[0].workPhotos[0].alt, "Koi on the forearm");
		assert.deepEqual(artist.artist.workPhotos, studio.artists[0].workPhotos);
		assert.deepEqual(studio.artists[1].workPhotos, []);
	});

	test("work photos from any other origin are dropped, and the page still loads", async () => {
		const sita = { ...SITA, workPhotos: [work("https://evil.example")] };
		const { fetch } = listing([sita, ARJUN]);

		const studio = await loadStudioPage(pageContext(fetch));

		assert.deepEqual(studio.artists[0].workPhotos, []);
		assert.equal(studio.artists[0].name, "Sita Rai");
	});

	test("an API that sends no workPhotos at all (older) still loads", async () => {
		const { workPhotos: _gone, ...older } = SITA;
		const { fetch } = listing([older as Artist, ARJUN]);

		const studio = await loadStudioPage(pageContext(fetch));

		assert.deepEqual(studio.artists[0].workPhotos, []);
	});
});

describe("the artist page's portfolio (TAT-126)", () => {
	test("asks for that artist's newest 24, the healed ones when asked", async () => {
		const plain = listing();
		await loadArtistPage(pageContext(plain.fetch), "sita", {});
		const healed = listing();
		await loadArtistPage(pageContext(healed.fetch), "sita", { healed: true });
		const next = listing();
		await loadArtistPage(pageContext(next.fetch), "sita", {
			healed: true,
			cursor: "c2",
		});

		const root = `${API}/api/v1/tenants/${STUDIO.slug}`;
		assert.deepEqual(plain.calls.map((call) => call.url).sort(), [
			`${root}/artists`,
			`${root}/work?artist=sita&limit=24`,
		]);
		assert.ok(
			healed.calls.some(
				(call) => call.url === `${root}/work?artist=sita&healed=true&limit=24`,
			),
		);
		assert.ok(
			next.calls.some(
				(call) =>
					call.url ===
					`${root}/work?artist=sita&healed=true&cursor=c2&limit=24`,
			),
		);
	});

	test("the answer becomes the page's gallery, with the address's filters", async () => {
		const page = galleryPage(2, { nextCursor: "c2" });
		const { fetch } = listing([SITA, ARJUN], page);
		const data = await loadArtistPage(
			pageContext(fetch, STUDIO, IMAGE_ORIGIN),
			"sita",
			{ healed: true },
		);

		assert.equal(data.portfolio.gallery.photos.length, 2);
		assert.equal(data.portfolio.gallery.nextCursor, "c2");
		assert.deepEqual(data.portfolio.search, { healed: true });
		assert.deepEqual(
			data,
			artistPageData(STUDIO, [SITA, ARJUN], "sita", ORIGIN, IMAGE_ORIGIN, {
				page,
				search: { healed: true },
			}),
		);
	});

	test("no photos is an empty gallery", async () => {
		const { fetch } = listing();
		const data = await loadArtistPage(pageContext(fetch), "sita", {});

		assert.deepEqual(data.portfolio, { gallery: EMPTY_GALLERY, search: {} });
	});

	test("a portfolio read that fails still renders the page, without the Work section", async () => {
		const failures: Array<() => Response> = [
			() => json(404, NOT_FOUND),
			() => json(500, { error: { code: "internal_error", message: "Boom." } }),
			() => json(502, { error: { code: "bad_gateway", message: "Down." } }),
			() =>
				json(429, { error: { code: "rate_limited", message: "Slow down." } }),
			// A 422 that is not about the address's own cursor or healed.
			() =>
				json(422, {
					error: {
						code: "validation_failed",
						message: "No.",
						fields: { limit: ["No."] },
					},
				}),
			() => {
				throw new TypeError("fetch failed");
			},
		];
		for (const [index, fail] of failures.entries()) {
			const { fetch } = fakeFetch(({ url }) => {
				if (url.endsWith("/artists")) return json(200, { data: [SITA] });
				return fail();
			});
			const data = await loadArtistPage(pageContext(fetch), "sita", {
				healed: true,
				cursor: "c2",
			});

			assert.equal(data.artist.name, "Sita Rai", String(index));
			assert.deepEqual(
				data.portfolio,
				{ gallery: EMPTY_GALLERY, search: {} },
				String(index),
			);
		}
	});

	describe("a portfolio that cannot be read is logged, and only that", () => {
		/** What each failure is logged as: the studio, the status and the code. */
		const FAILURES: Array<{
			name: string;
			respond: () => Response;
			logged: { status: number; code: string };
		}> = [
			{
				name: "a 500",
				respond: () =>
					json(500, {
						error: { code: "internal_error", message: "Boom in /secret/path." },
					}),
				logged: { status: 500, code: "internal_error" },
			},
			{
				name: "a platform without /work (404)",
				respond: () => json(404, NOT_FOUND),
				logged: { status: 404, code: "not_found" },
			},
			{
				name: "a network error",
				respond: () => {
					throw new TypeError("fetch failed: http://api.test/secret");
				},
				logged: { status: 0, code: "network_error" },
			},
		];
		const withArtists = (respondToWork: () => Response) =>
			fakeFetch(({ url }) =>
				url.endsWith("/artists")
					? json(200, { data: [SITA] })
					: respondToWork(),
			);

		for (const { name, respond, logged } of FAILURES) {
			test(`${name} logs the studio, status and code once, and the page still renders`, async (t) => {
				const log = t.mock.method(console, "error", () => {});
				const { fetch } = withArtists(respond);
				const data = await loadArtistPage(pageContext(fetch), "sita", {
					cursor: "secretcursor",
				});

				assert.equal(data.artist.name, "Sita Rai");
				assert.deepEqual(data.portfolio, {
					gallery: EMPTY_GALLERY,
					search: {},
				});
				assert.deepEqual(
					log.mock.calls.map((call) => call.arguments),
					[["Portfolio read failed", { slug: STUDIO.slug, ...logged }]],
				);
			});
		}

		test("what is not an API error is logged without its status, code or text", async (t) => {
			const log = t.mock.method(console, "error", () => {});
			const { fetch } = listing();
			const context = pageContext(fetch);
			const query = context.queryClient.query.bind(context.queryClient);
			t.mock.method(
				context.queryClient,
				"query",
				(options: { queryKey: readonly unknown[] }) => {
					// Only the gallery read breaks; the studio and the artists read as before.
					if (options.queryKey.includes("work")) {
						throw new TypeError("a bug with secretcursor in http://api.test/x");
					}
					return query(options as never);
				},
			);
			const data = await loadArtistPage(context, "sita", {
				cursor: "secretcursor",
			});

			assert.deepEqual(data.portfolio.gallery, EMPTY_GALLERY);
			assert.deepEqual(
				log.mock.calls.map((call) => call.arguments),
				[
					[
						"Portfolio read failed",
						{ slug: STUDIO.slug, status: undefined, code: undefined },
					],
				],
			);
		});

		test("the line holds no error, address, cursor or key", async (t) => {
			const log = t.mock.method(console, "error", () => {});
			for (const { respond } of FAILURES) {
				await loadArtistPage(pageContext(withArtists(respond).fetch), "sita", {
					cursor: "secretcursor",
					healed: true,
				});
			}

			const written = JSON.stringify(log.mock.calls.map((c) => c.arguments));
			assert.equal(log.mock.calls.length, FAILURES.length);
			for (const secret of ["secretcursor", "secret", "api.test", "Boom"]) {
				assert.ok(!written.includes(secret), secret);
			}
		});

		test("the address's own refused cursor or healed is the not-found, not a log line", async (t) => {
			const log = t.mock.method(console, "error", () => {});
			for (const field of ["cursor", "healed"]) {
				const { fetch } = withArtists(() =>
					json(422, {
						error: {
							code: "validation_failed",
							message: "No.",
							fields: { [field]: ["No."] },
						},
					}),
				);
				await assert.rejects(
					loadArtistPage(pageContext(fetch), "sita", { cursor: "!!" }),
					notFound,
					field,
				);
			}

			assert.equal(log.mock.calls.length, 0);
		});

		test("a portfolio that reads fine logs nothing", async (t) => {
			const log = t.mock.method(console, "error", () => {});
			const { fetch } = listing();
			await loadArtistPage(pageContext(fetch), "sita", {});

			assert.equal(log.mock.calls.length, 0);
		});
	});

	test("a portfolio read that is not a gallery at all is an empty one", async () => {
		const { fetch } = listing([SITA], { data: "x", filters: 5 });
		const data = await loadArtistPage(pageContext(fetch), "sita", {});

		assert.deepEqual(data.portfolio.gallery, EMPTY_GALLERY);
	});

	test("an artist page whose own cursor is garbled (422 validation_failed) is the not-found", async () => {
		for (const field of ["cursor", "healed"]) {
			const { fetch } = fakeFetch(({ url }) =>
				url.endsWith("/artists")
					? json(200, { data: [SITA] })
					: json(422, {
							error: {
								code: "validation_failed",
								message: "No.",
								fields: { [field]: ["No."] },
							},
						}),
			);
			await assert.rejects(
				loadArtistPage(pageContext(fetch), "sita", { cursor: "!!" }),
				notFound,
				field,
			);
		}
	});

	test("an unknown artist is still the not-found, whatever the work read says", async () => {
		const { fetch } = listing();
		await assert.rejects(
			loadArtistPage(pageContext(fetch), "nobody", {}),
			notFound,
		);
	});

	test("the page and the strip on the studio page still come from the artist list", async () => {
		const { fetch } = listing([sitaWithWork(4), ARJUN]);
		const data = await loadArtistPage(
			pageContext(fetch, STUDIO, IMAGE_ORIGIN),
			"sita",
			{},
		);

		assert.equal(data.artist.workPhotos.length, 4);
		assert.deepEqual(data.portfolio.gallery, EMPTY_GALLERY);
	});
});

describe("the All work page's loader (TAT-126)", () => {
	const root = `${API}/api/v1/tenants/${STUDIO.slug}`;

	test("reads the artists and the first page with the address's filters", async () => {
		const page = galleryPage(3, { nextCursor: "c2" });
		const { calls, fetch } = listing([sitaWithWork(2), ARJUN], page);
		const search = {
			artist: "sita",
			style: "fine-line",
			healed: true as const,
		};
		const data = await loadWorkPage(
			pageContext(fetch, STUDIO, IMAGE_ORIGIN),
			search,
		);

		assert.deepEqual(calls.map((call) => call.url).sort(), [
			`${IMAGE_ORIGIN}/api/v1/tenants/${STUDIO.slug}/artists`,
			`${IMAGE_ORIGIN}/api/v1/tenants/${STUDIO.slug}/work?artist=sita&style=fine-line&healed=true&limit=24`,
		]);
		assert.deepEqual(
			data,
			workPageData(
				STUDIO,
				[sitaWithWork(2), ARJUN],
				page,
				search,
				ORIGIN,
				IMAGE_ORIGIN,
			),
		);
		assert.deepEqual(data.search, search);
		assert.equal(data.gallery.photos.length, 3);
		assert.equal(data.seo.canonical, `${ORIGIN}/work`);
	});

	test("asks for the next page of the address's cursor", async () => {
		const { calls, fetch } = listing();
		await loadWorkPage(pageContext(fetch), { cursor: "c2" });

		assert.ok(
			calls.some((call) => call.url === `${root}/work?cursor=c2&limit=24`),
		);
	});

	test("offers the visible artists who have a photo, by name", () => {
		const bina = {
			...sitaWithWork(1),
			id: "b",
			slug: "bina",
			name: "Bina Gurung",
		};
		const eka = { ...sitaWithWork(1), id: "e", slug: "eka", name: "Eka Lama" };
		const data = workPageData(
			STUDIO,
			[eka, ARJUN, sitaWithWork(2), bina],
			galleryPage(1),
			{},
			ORIGIN,
			IMAGE_ORIGIN,
		);

		assert.deepEqual(data.artists, [
			{ slug: "bina", name: "Bina Gurung" },
			{ slug: "eka", name: "Eka Lama" },
			{ slug: "sita", name: "Sita Rai" },
		]);
		// Without the API's origin no photo is one, so no artist is offered.
		assert.deepEqual(
			workPageData(STUDIO, [eka], galleryPage(1), {}, ORIGIN).artists,
			[],
		);
	});

	test("an empty or older answer is an empty gallery, and the page still loads", async () => {
		for (const answer of [
			EMPTY_PAGE,
			{ data: "x" },
			{ data: [], filters: 5 },
		]) {
			const { fetch } = listing([SITA], answer);
			const data = await loadWorkPage(pageContext(fetch), {});

			assert.deepEqual(data.gallery, EMPTY_GALLERY);
			assert.deepEqual(data.artists, []);
		}
	});

	test("a 422 validation_failed from the work read is a not-found", async () => {
		const { fetch } = fakeFetch(({ url }) =>
			url.endsWith("/artists")
				? json(200, { data: [SITA] })
				: json(422, VALIDATION_FAILED),
		);
		await assert.rejects(
			loadWorkPage(pageContext(fetch), { cursor: "!!" }),
			notFound,
		);
	});

	test("the work read's own 404 is a not-found too", async () => {
		const { fetch } = fakeFetch(({ url }) =>
			url.endsWith("/artists")
				? json(200, { data: [SITA] })
				: json(404, NOT_FOUND),
		);
		await assert.rejects(loadWorkPage(pageContext(fetch), {}), notFound);
	});

	test("any other failure of the work read is an error, not a not-found", async () => {
		for (const respond of [
			() => json(500, { error: { code: "internal_error", message: "Boom." } }),
			() => {
				throw new TypeError("fetch failed");
			},
		]) {
			const { fetch } = fakeFetch(({ url }) =>
				url.endsWith("/artists") ? json(200, { data: [SITA] }) : respond(),
			);
			await assert.rejects(
				loadWorkPage(pageContext(fetch), {}),
				(error: unknown) =>
					error instanceof TattooApiError && !isNotFound(error),
			);
		}
	});
});

describe("Show more (TAT-126)", () => {
	test("reads the next page with the same filters and numbers the photos on", async () => {
		const page = galleryPage(2);
		const { calls, fetch } = listing([SITA], page);
		const context = pageContext(fetch, STUDIO, IMAGE_ORIGIN);
		const more = await moreWork(
			context,
			{ artist: "sita", healed: true, limit: 24 },
			"c2",
			24,
			IMAGE_ORIGIN,
		);

		assert.deepEqual(
			calls.map((call) => call.url),
			[
				`${IMAGE_ORIGIN}/api/v1/tenants/${STUDIO.slug}/work?artist=sita&healed=true&cursor=c2&limit=24`,
			],
		);
		assert.equal(more.photos.length, 2);
		assert.equal(more.photos[0].dialogId, "work-photo-25");
	});

	test("a cursor of its own replaces the one the page was opened with", async () => {
		const { calls, fetch } = listing();
		await moreWork(
			pageContext(fetch),
			{ cursor: "first", limit: 24 },
			"second",
			24,
			API,
		);

		assert.ok(calls[0].url.includes("cursor=second"));
		assert.ok(!calls[0].url.includes("cursor=first"));
	});

	test("a failure is thrown, for the page to say so", async () => {
		const { fetch } = fakeFetch(() =>
			json(500, { error: { code: "internal_error", message: "Boom." } }),
		);
		await assert.rejects(
			moreWork(pageContext(fetch), { limit: 24 }, "c2", 24, API),
			(error: unknown) => error instanceof TattooApiError,
		);
	});
});
