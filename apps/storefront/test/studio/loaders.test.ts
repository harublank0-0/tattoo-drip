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
import { EMPTY_GALLERY, galleryView } from "../../src/studio/gallery.ts";
import {
	artistPageData,
	flashDesignPageData,
	flashPageData,
	loadArtistPage,
	loadFlashDesignPage,
	loadFlashPage,
	loadRequestPage,
	loadStudioPage,
	loadWorkPage,
	logReadFailed,
	moreWork,
	requestPageData,
	studioPageData,
	workPageData,
} from "../../src/studio/loaders.ts";
import { fakeFetch, json } from "../tenancy/helpers.ts";
import {
	ARJUN,
	CLOSED_STUDIO,
	EMPTY_FLASH_PAGE,
	flashId,
	flashPage,
	GOOD_TO_KNOW_STUDIO,
	galleryPage,
	ORIGIN,
	SITA,
	STUDIO,
	sitaWithWork,
} from "./fixtures.ts";
import { IMAGE_ORIGIN, withStorefront } from "./theme-fixtures.ts";

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

/**
 * An API that lists `artists`, answers the gallery read with `work` and the
 * flash read with `flash`, gives the flash design `design` (a 404 for any
 * other id) and knows nothing else.
 */
function listing(
	artists: Artist[] = [SITA, ARJUN],
	work: unknown = EMPTY_PAGE,
	flash: unknown = EMPTY_FLASH_PAGE,
	design: unknown = null,
) {
	return fakeFetch(({ url }) => {
		if (url.endsWith("/artists")) return json(200, { data: artists });
		if (url.includes("/work?")) return json(200, work);
		if (url.includes("/flash?")) return json(200, flash);
		if (url.includes("/flash/")) {
			return design === null
				? json(404, NOT_FOUND)
				: json(200, { data: design });
		}
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

describe("logReadFailed (shared by the pages whose reads may fail)", () => {
	test("says what failed, for which studio, with the status and code and nothing else", (t) => {
		const log = t.mock.method(console, "error", () => {});
		const context = pageContext(listing().fetch);

		logReadFailed(
			"Gallery",
			context,
			new TattooApiError(502, {
				code: "bad_gateway",
				message: "secret detail",
			}),
		);
		logReadFailed("Gallery", context, new Error("secret detail"));

		assert.deepEqual(
			log.mock.calls.map((call) => call.arguments),
			[
				[
					"Gallery read failed",
					{ slug: STUDIO.slug, status: 502, code: "bad_gateway" },
				],
				[
					"Gallery read failed",
					{ slug: STUDIO.slug, status: undefined, code: undefined },
				],
			],
		);
	});
});

describe("loadStudioPage", () => {
	const TENANT = `${API}/api/v1/tenants/${STUDIO.slug}`;

	test("reads the artists and the newest 9 photos once, and the studio from the cache", async () => {
		const { calls, fetch } = listing();
		const context = pageContext(fetch);

		assert.deepEqual(
			await loadStudioPage(context),
			studioPageData(STUDIO, [SITA, ARJUN], ORIGIN),
		);
		await loadStudioPage(context);
		assert.deepEqual(calls.map((call) => call.url).sort(), [
			`${TENANT}/artists`,
			`${TENANT}/flash?limit=6`,
			`${TENANT}/work?limit=9`,
		]);
	});

	describe("Recent work is read only when the page shows it", () => {
		const sections = (...types: string[]) =>
			withStorefront({ sections: types.map((type) => ({ type, props: {} })) });

		test("sections without work make no /work read, and the page has no recent photos", async () => {
			const { calls, fetch } = listing([SITA, ARJUN], galleryPage(9));
			const data = await loadStudioPage(
				pageContext(fetch, sections("artists", "inquiry"), IMAGE_ORIGIN),
			);

			assert.deepEqual(
				calls.map((call) => call.url),
				[`${IMAGE_ORIGIN}/api/v1/tenants/${STUDIO.slug}/artists`],
			);
			assert.deepEqual(data.theme.sections, ["artists", "inquiry"]);
			assert.deepEqual(data.recentWork, EMPTY_GALLERY);
			assert.equal(data.artists.length, 2);
		});

		test("sections with work, wherever it sits, make one /work?limit=9 read", async () => {
			for (const order of [
				["work", "artists", "inquiry"],
				["inquiry", "artists", "work"],
			]) {
				const { calls, fetch } = listing([SITA, ARJUN], galleryPage(9));
				const data = await loadStudioPage(
					pageContext(fetch, sections(...order), IMAGE_ORIGIN),
				);

				assert.deepEqual(
					calls.map((call) => call.url).sort(),
					[
						`${IMAGE_ORIGIN}/api/v1/tenants/${STUDIO.slug}/artists`,
						`${IMAGE_ORIGIN}/api/v1/tenants/${STUDIO.slug}/work?limit=9`,
					],
					order.join(),
				);
				assert.deepEqual(data.theme.sections, order);
				assert.equal(data.recentWork.photos.length, 9, order.join());
			}
		});

		test("a studio with no storefront configuration (the default order) reads it too", async () => {
			const { calls, fetch } = listing([SITA, ARJUN], galleryPage(2));
			const data = await loadStudioPage(pageContext(fetch));

			assert.ok(data.theme.sections.includes("work"));
			assert.ok(calls.some((call) => call.url.endsWith("/work?limit=9")));
		});
	});

	test("the studio page reads the artists and the newest 9 photos", async () => {
		const { calls, fetch } = listing([SITA, ARJUN], galleryPage(9));
		const data = await loadStudioPage(pageContext(fetch, STUDIO, IMAGE_ORIGIN));

		assert.deepEqual(calls.map((call) => call.url).sort(), [
			`${IMAGE_ORIGIN}/api/v1/tenants/${STUDIO.slug}/artists`,
			`${IMAGE_ORIGIN}/api/v1/tenants/${STUDIO.slug}/flash?limit=6`,
			`${IMAGE_ORIGIN}/api/v1/tenants/${STUDIO.slug}/work?limit=9`,
		]);
		assert.equal(data.recentWork.photos.length, 9);
		assert.deepEqual(
			data.recentWork,
			galleryView(galleryPage(9), IMAGE_ORIGIN),
		);
		assert.equal(data.recentWork.photos[0].artist?.href, "/artists/sita");
	});

	describe("Flash is read only when the page shows it (TAT-129)", () => {
		const sections = (...types: string[]) =>
			withStorefront({ sections: types.map((type) => ({ type, props: {} })) });
		const ROOT = `${IMAGE_ORIGIN}/api/v1/tenants/${STUDIO.slug}`;

		test("sections without flash make no /flash read, and the page has no designs", async () => {
			const { calls, fetch } = listing([SITA, ARJUN], EMPTY_PAGE, flashPage(6));
			const data = await loadStudioPage(
				pageContext(fetch, sections("artists", "inquiry"), IMAGE_ORIGIN),
			);

			assert.deepEqual(
				calls.map((call) => call.url),
				[`${ROOT}/artists`],
			);
			assert.deepEqual(data.flash.designs, []);
		});

		test("the studio page also reads the newest 6 designs, wherever flash sits", async () => {
			for (const order of [
				["flash", "artists", "inquiry"],
				["inquiry", "artists", "flash"],
			]) {
				const { calls, fetch } = listing(
					[SITA, ARJUN],
					EMPTY_PAGE,
					flashPage(6, { nextCursor: "c2" }),
				);
				const data = await loadStudioPage(
					pageContext(fetch, sections(...order), IMAGE_ORIGIN),
				);

				assert.deepEqual(
					calls.map((call) => call.url).sort(),
					[`${ROOT}/artists`, `${ROOT}/flash?limit=6`],
					order.join(),
				);
				assert.equal(data.flash.designs.length, 6, order.join());
				assert.equal(data.flash.designs[0].name, "Moth");
			}
		});

		for (const { name, respond, logged } of [
			{
				name: "a platform without /flash (404)",
				respond: () => json(404, NOT_FOUND),
				logged: { status: 404, code: "not_found" },
			},
			{
				name: "a 500",
				respond: () =>
					json(500, {
						error: { code: "internal_error", message: "Boom in /secret." },
					}),
				logged: { status: 500, code: "internal_error" },
			},
			{
				name: "a network error",
				respond: (): Response => {
					throw new TypeError("fetch failed: http://api.test/secret");
				},
				logged: { status: 0, code: "network_error" },
			},
		]) {
			test(`${name} still gives the studio page, without Flash, and logs 'Flash read failed' once`, async (t) => {
				const log = t.mock.method(console, "error", () => {});
				const { fetch } = fakeFetch(({ url }) =>
					url.endsWith("/artists")
						? json(200, { data: [SITA, ARJUN] })
						: url.includes("/flash?")
							? respond()
							: json(200, EMPTY_PAGE),
				);

				const data = await loadStudioPage(pageContext(fetch));

				assert.equal(data.artists.length, 2);
				assert.deepEqual(data.flash.designs, []);
				assert.deepEqual(
					log.mock.calls.map((call) => call.arguments),
					[["Flash read failed", { slug: STUDIO.slug, ...logged }]],
				);
			});
		}
	});

	test("studioPageData takes the flash answer as it came, and none is no designs", () => {
		const page = flashPage(3);

		assert.equal(
			studioPageData(STUDIO, [SITA], ORIGIN, IMAGE_ORIGIN, null, page).flash
				.designs.length,
			3,
		);
		for (const none of [undefined, null, "broken", {}, { data: "x" }]) {
			assert.deepEqual(
				studioPageData(STUDIO, [SITA], ORIGIN, IMAGE_ORIGIN, null, none).flash
					.designs,
				[],
				String(none),
			);
		}
	});

	test("studioPageData takes the work answer as it came, and none is no photos", () => {
		const page = galleryPage(4);

		assert.deepEqual(
			studioPageData(STUDIO, [SITA], ORIGIN, IMAGE_ORIGIN, page).recentWork,
			galleryView(page, IMAGE_ORIGIN),
		);
		for (const none of [undefined, null, "broken", {}, { data: "x" }]) {
			assert.deepEqual(
				studioPageData(STUDIO, [SITA], ORIGIN, IMAGE_ORIGIN, none).recentWork,
				EMPTY_GALLERY,
				String(none),
			);
		}
		// Without the API's origin no photo is kept.
		assert.deepEqual(
			studioPageData(STUDIO, [SITA], ORIGIN, null, page).recentWork.photos,
			[],
		);
	});

	describe("a work read that fails still gives the studio page, with an empty Recent work", () => {
		/** What each failure is logged as: the studio, the status and the code. */
		const FAILURES: Array<{
			name: string;
			respond: () => Response;
			logged: { status: number; code: string };
		}> = [
			{
				name: "a platform without /work (404)",
				respond: () => json(404, NOT_FOUND),
				logged: { status: 404, code: "not_found" },
			},
			{
				name: "a 500",
				respond: () =>
					json(500, {
						error: { code: "internal_error", message: "Boom in /secret/path." },
					}),
				logged: { status: 500, code: "internal_error" },
			},
			{
				name: "a refused read (422)",
				respond: () => json(422, VALIDATION_FAILED),
				logged: { status: 422, code: "validation_failed" },
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
					? json(200, { data: [SITA, ARJUN] })
					: url.includes("/flash?")
						? json(200, EMPTY_FLASH_PAGE)
						: respondToWork(),
			);

		for (const { name, respond, logged } of FAILURES) {
			test(`${name} logs the studio, status and code once, and the page still has its artists`, async (t) => {
				const log = t.mock.method(console, "error", () => {});
				const data = await loadStudioPage(
					pageContext(withArtists(respond).fetch),
				);

				assert.equal(data.artists.length, 2);
				assert.equal(data.inquiry.kind, "open");
				assert.deepEqual(data.recentWork, EMPTY_GALLERY);
				assert.deepEqual(
					log.mock.calls.map((call) => call.arguments),
					[["Recent work read failed", { slug: STUDIO.slug, ...logged }]],
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
						throw new TypeError("a bug at http://api.test/secret");
					}
					return query(options as never);
				},
			);
			const data = await loadStudioPage(context);

			assert.deepEqual(data.recentWork, EMPTY_GALLERY);
			assert.deepEqual(
				log.mock.calls.map((call) => call.arguments),
				[
					[
						"Recent work read failed",
						{ slug: STUDIO.slug, status: undefined, code: undefined },
					],
				],
			);
		});

		test("the line holds no error, address or key", async (t) => {
			const log = t.mock.method(console, "error", () => {});
			for (const { respond } of FAILURES) {
				await loadStudioPage(pageContext(withArtists(respond).fetch));
			}

			const written = JSON.stringify(log.mock.calls.map((c) => c.arguments));
			assert.equal(log.mock.calls.length, FAILURES.length);
			for (const secret of ["secret", "api.test", "Boom", "cursor"]) {
				assert.ok(!written.includes(secret), secret);
			}
		});

		test("a work read that works logs nothing", async (t) => {
			const log = t.mock.method(console, "error", () => {});
			const { fetch } = listing([SITA, ARJUN], galleryPage(5));
			const data = await loadStudioPage(
				pageContext(fetch, STUDIO, IMAGE_ORIGIN),
			);

			assert.equal(data.recentWork.photos.length, 5);
			assert.equal(log.mock.calls.length, 0);
		});

		test("the artists failing is still an error: only the work read degrades", async (t) => {
			t.mock.method(console, "error", () => {});
			const { fetch } = fakeFetch(({ url }) =>
				url.endsWith("/artists")
					? json(500, { error: { code: "internal_error", message: "Boom." } })
					: json(200, galleryPage(3)),
			);

			await assert.rejects(
				loadStudioPage(pageContext(fetch, STUDIO, IMAGE_ORIGIN)),
				(error: unknown) =>
					error instanceof TattooApiError && !isNotFound(error),
			);
		});
	});

	test("the studio page's data keeps the invitation's state and holds no inquiry channels; the header and chat button are its own", async () => {
		const { fetch } = listing();
		const data = await loadStudioPage(pageContext(fetch));

		assert.deepEqual(Object.keys(data).sort(), [
			"artists",
			"chat",
			"flash",
			"goodToKnow",
			"inquiry",
			"openNow",
			"recentWork",
			"requestLink",
			"seo",
			"studio",
			"theme",
		]);
		assert.deepEqual(data.requestLink, {
			href: "/request",
			artistName: null,
		});
		assert.equal(
			data.chat?.whatsapp,
			"https://wa.me/9779812345678?text=Hi%2C%20I'm%20asking%20about%20a%20tattoo",
		);
		assert.equal(data.chat?.viber, "viber://chat?number=%2B9779812345678");
	});

	test("sets today's steady state from the clock; studioPageData has none", async () => {
		const { fetch } = listing();
		const context = pageContext(fetch, GOOD_TO_KNOW_STUDIO);

		const data = await loadStudioPage(context);

		// Whatever the day, the loader's view is there (the studio has hours)
		// and its initial state is a state or null, never anything else.
		assert.ok(data.openNow);
		assert.equal(data.openNow.timezone, "Asia/Kathmandu");
		assert.ok(
			data.openNow.initial === null ||
				["open", "later", "closed", "closure"].includes(
					data.openNow.initial.kind,
				),
		);
		assert.equal(data.goodToKnow.hours.length > 0, true);
		// The pure builder has no clock: no initial state.
		const pure = studioPageData(GOOD_TO_KNOW_STUDIO, [SITA], ORIGIN);
		assert.ok(pure.openNow);
		assert.equal(pure.openNow.initial, null);
		// A studio with no hours has no view either way.
		assert.equal(
			(await loadStudioPage(pageContext(listing().fetch))).openNow,
			null,
		);
	});

	test("a closed studio's page takes no inquiry", async () => {
		const { fetch } = listing([ARJUN]);
		const data = await loadStudioPage(pageContext(fetch, CLOSED_STUDIO));

		assert.equal(data.studio.accepting, false);
		assert.equal(data.inquiry.kind, "studio-closed");
	});

	test("the API failing is an error, not a not-found", async (t) => {
		t.mock.method(console, "error", () => {});
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

	test("the list's own not_found (the studio went away) is a not-found", async (t) => {
		t.mock.method(console, "error", () => {});
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
		assert.equal(data.artist.requestHref, "/request?artist=sita");
	});

	test("the artist page's data holds no inquiry state and no inquiry channels: the form is on /request", async () => {
		const { fetch } = listing();
		const data = await loadArtistPage(pageContext(fetch), "sita", {});

		assert.deepEqual(Object.keys(data).sort(), [
			"artist",
			"chat",
			"flash",
			"portfolio",
			"requestLink",
			"seo",
			"studio",
			"theme",
		]);
	});

	test("the header asks for the artist while they take new work, else for the studio, else for nothing; the chat names them", async () => {
		const { fetch } = listing();
		const sita = await loadArtistPage(pageContext(fetch), "sita", {});
		const arjun = await loadArtistPage(pageContext(fetch), "arjun", {});
		const closed = await loadArtistPage(
			pageContext(fetch, CLOSED_STUDIO),
			"arjun",
			{},
		);

		assert.deepEqual(sita.requestLink, {
			href: "/request?artist=sita",
			artistName: "Sita Rai",
		});
		assert.ok(sita.chat?.whatsapp.endsWith("about%20Sita%20Rai"));
		// A closed artist, the studio open: the studio's request.
		assert.deepEqual(arjun.requestLink, { href: "/request", artistName: null });
		assert.ok(arjun.chat?.whatsapp.endsWith(encodeURIComponent("अर्जुन थापा")));
		// Both closed: nothing to lead to.
		assert.equal(closed.requestLink, null);
		assert.ok(closed.chat);
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

	test("a closed artist's page carries their status words", async () => {
		const { fetch } = listing();
		const data = await loadArtistPage(pageContext(fetch), "arjun", {});

		assert.equal(data.artist.accepting, false);
		assert.equal(data.artist.closedMessage, "Books open in March.");
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
			`${root}/flash?artist=sita&limit=12`,
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

	test("a portfolio read that fails still renders the page, without the Work section", async (t) => {
		// Each failure is logged (pinned below); this test is about the page.
		t.mock.method(console, "error", () => {});
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
					: url.includes("/flash?")
						? json(200, EMPTY_FLASH_PAGE)
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

describe("loadRequestPage (TAT-127)", () => {
	const TENANT = `${API}/api/v1/tenants/${STUDIO.slug}`;

	test("reads the artists once (the studio from the cache) and picks the address's artist", async () => {
		const { calls, fetch } = listing();
		const context = pageContext(fetch);
		const search = { artist: "sita" };

		const data = await loadRequestPage(context, search);

		assert.deepEqual(
			data,
			requestPageData(STUDIO, [SITA, ARJUN], search, ORIGIN),
		);
		assert.equal(data.inquiry.kind, "open");
		assert.equal(
			data.inquiry.kind === "open" && data.inquiry.preferredArtist?.id,
			SITA.id,
		);
		assert.equal(data.seo.canonical, `${ORIGIN}/request?artist=sita`);
		// The artists alone: no studio read (cached), no gallery read.
		assert.deepEqual(
			calls.map((call) => call.url),
			[`${TENANT}/artists`],
		);
		await loadRequestPage(context, search);
		assert.equal(calls.length, 1);
	});

	test("the chat button names the picked artist, open or closed, else asks about a tattoo; the page has no Request button", async () => {
		const { fetch } = listing();
		const context = pageContext(fetch);
		const chatOf = async (search: { artist?: string }) =>
			(await loadRequestPage(context, search)).chat?.whatsapp;

		assert.ok(
			(await chatOf({ artist: "sita" }))?.endsWith("about%20Sita%20Rai"),
		);
		assert.ok(
			(await chatOf({ artist: "arjun" }))?.endsWith(
				encodeURIComponent("अर्जुन थापा"),
			),
		);
		for (const search of [{}, { artist: "nobody" }]) {
			assert.ok((await chatOf(search))?.endsWith("about%20a%20tattoo"));
		}
		assert.equal("requestLink" in (await loadRequestPage(context, {})), false);
	});

	test("an unknown, hidden or renamed artist is the general form, never a not-found", async () => {
		const { fetch } = listing();
		// Hidden and deleted artists, and old slugs, aren't in the list the API sends.
		for (const search of [{ artist: "nobody" }, { artist: "sita-old" }, {}]) {
			const data = await loadRequestPage(pageContext(fetch), search);

			assert.equal(data.inquiry.kind, "open", JSON.stringify(search));
			assert.equal(
				data.inquiry.kind === "open" && data.inquiry.preferredArtist,
				null,
				JSON.stringify(search),
			);
			assert.equal(data.seo.canonical, `${ORIGIN}/request`);
		}
	});

	test("a closed artist is their own closed page, with the studio's general request still open", async () => {
		const { fetch } = listing();
		const data = await loadRequestPage(pageContext(fetch), {
			artist: "arjun",
		});

		assert.deepEqual(data.inquiry, {
			kind: "artist-closed",
			studioName: "Black Needle",
			artistName: "अर्जुन थापा",
			studioOpen: true,
			closedMessage: "Books open in March.",
		});
	});

	test("an open artist's page works while the studio as a whole is closed", async () => {
		const { fetch } = listing();
		const closed = pageContext(fetch, CLOSED_STUDIO);

		const sita = await loadRequestPage(closed, { artist: "sita" });
		assert.equal(sita.inquiry.kind, "open");
		assert.equal(
			sita.inquiry.kind === "open" && sita.inquiry.preferredArtist?.id,
			SITA.id,
		);
		assert.ok(sita.channels.whatsapp?.includes("Sita%20Rai"));

		// The general form and the closed artist's page say so, and offer no form.
		assert.deepEqual((await loadRequestPage(closed, {})).inquiry, {
			kind: "studio-closed",
			studioName: "Black Needle",
		});
		const arjun = await loadRequestPage(closed, { artist: "arjun" });
		assert.equal(arjun.inquiry.kind, "artist-closed");
		assert.equal(
			arjun.inquiry.kind === "artist-closed" && arjun.inquiry.studioOpen,
			false,
		);
	});

	test("its head agrees with the page: a refusal never invites, an open artist's page always does", async () => {
		const { fetch } = listing();

		// A closed artist, the studio open.
		const arjun = await loadRequestPage(pageContext(fetch), {
			artist: "arjun",
		});
		assert.equal(arjun.seo.title, "Inquiries for अर्जुन थापा at Black Needle");
		assert.equal(
			arjun.seo.description,
			"अर्जुन थापा isn't taking new inquiries right now.",
		);
		assert.equal(arjun.seo.canonical, `${ORIGIN}/request?artist=arjun`);

		// The studio closed: the general page declines, an open artist's page does not.
		const closed = pageContext(fetch, CLOSED_STUDIO);
		const general = await loadRequestPage(closed, {});
		assert.equal(general.seo.title, "Inquiries at Black Needle");
		assert.equal(
			general.seo.description,
			"Black Needle isn't taking new inquiries right now.",
		);
		const sita = await loadRequestPage(closed, { artist: "sita" });
		assert.equal(sita.seo.title, "Send your idea to Sita Rai at Black Needle");
		assert.match(sita.seo.description, /^Tell Sita Rai about the tattoo/);

		// The open general page.
		const open = await loadRequestPage(pageContext(fetch), {});
		assert.equal(open.seo.title, "Send your idea to Black Needle");
	});

	test("a failed artists read fails it like the other pages", async () => {
		const { fetch } = fakeFetch(() =>
			json(500, { error: { code: "internal_error", message: "Boom." } }),
		);
		await assert.rejects(
			loadRequestPage(pageContext(fetch), { artist: "sita" }),
			(error: unknown) => error instanceof TattooApiError && !isNotFound(error),
		);

		const missing = fakeFetch(() => json(404, NOT_FOUND));
		await assert.rejects(
			loadRequestPage(pageContext(missing.fetch), {}),
			notFound,
		);
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

describe("the artist page's flash (TAT-129)", () => {
	const root = `${API}/api/v1/tenants/${STUDIO.slug}`;

	test("also asks for that artist's newest 12 designs", async () => {
		const page = flashPage(3, { nextCursor: "c2" });
		const { calls, fetch } = listing([SITA, ARJUN], EMPTY_PAGE, page);

		const data = await loadArtistPage(
			pageContext(fetch, STUDIO, IMAGE_ORIGIN),
			"sita",
			{},
		);

		assert.ok(
			calls.some(
				(call) =>
					call.url ===
					`${IMAGE_ORIGIN}/api/v1/tenants/${STUDIO.slug}/flash?artist=sita&limit=12`,
			),
		);
		assert.equal(data.flash.designs.length, 3);
		assert.equal(data.flash.nextCursor, "c2");
		assert.equal(data.flash.designs[0].name, "Moth");
		assert.ok(calls.every((call) => !call.url.includes(`${root}/flash/`)));
	});

	const FAILURES: Array<{
		name: string;
		respond: () => Response;
		logged: { status: number; code: string };
	}> = [
		{
			name: "a platform without /flash (404)",
			respond: () => json(404, NOT_FOUND),
			logged: { status: 404, code: "not_found" },
		},
		{
			name: "a 500",
			respond: () =>
				json(500, {
					error: { code: "internal_error", message: "Boom in /secret." },
				}),
			logged: { status: 500, code: "internal_error" },
		},
		{
			name: "a network error",
			respond: () => {
				throw new TypeError("fetch failed: http://api.test/secret");
			},
			logged: { status: 0, code: "network_error" },
		},
	];
	for (const { name, respond, logged } of FAILURES) {
		test(`${name} still renders the page, without the Flash section, and logs 'Flash read failed' once`, async (t) => {
			const log = t.mock.method(console, "error", () => {});
			const { fetch } = fakeFetch(({ url }) =>
				url.endsWith("/artists")
					? json(200, { data: [SITA] })
					: url.includes("/flash?")
						? respond()
						: json(200, EMPTY_PAGE),
			);

			const data = await loadArtistPage(pageContext(fetch), "sita", {});

			assert.equal(data.artist.name, "Sita Rai");
			assert.deepEqual(data.flash.designs, []);
			assert.deepEqual(
				log.mock.calls.map((call) => call.arguments),
				[["Flash read failed", { slug: STUDIO.slug, ...logged }]],
			);
		});
	}
});

describe("the flash page's loader (TAT-129)", () => {
	const root = `${API}/api/v1/tenants/${STUDIO.slug}`;

	test("reads the artists and the first 24 with the address's filter", async () => {
		const page = flashPage(3, { nextCursor: "c2" });
		const { calls, fetch } = listing([SITA, ARJUN], EMPTY_PAGE, page);
		const search = { artist: "sita", cursor: "c1" };

		const data = await loadFlashPage(
			pageContext(fetch, STUDIO, IMAGE_ORIGIN),
			search,
		);

		assert.deepEqual(calls.map((call) => call.url).sort(), [
			`${IMAGE_ORIGIN}/api/v1/tenants/${STUDIO.slug}/artists`,
			`${IMAGE_ORIGIN}/api/v1/tenants/${STUDIO.slug}/flash?artist=sita&cursor=c1&limit=24`,
		]);
		assert.deepEqual(
			data,
			flashPageData(STUDIO, [SITA, ARJUN], page, search, ORIGIN, IMAGE_ORIGIN),
		);
		assert.deepEqual(data.search, search);
		assert.equal(data.list.designs.length, 3);
		assert.equal(data.seo.canonical, `${ORIGIN}/flash`);
		assert.equal(data.requestLink?.href, "/request");
		// The chat names the artist the address filters by.
		assert.ok(data.chat?.whatsapp.includes("Sita%20Rai"));
	});

	test("with no filter it reads /flash?limit=24, and the chat asks about a tattoo", async () => {
		const { calls, fetch } = listing();
		const data = await loadFlashPage(pageContext(fetch), {});

		assert.ok(calls.some((call) => call.url === `${root}/flash?limit=24`));
		assert.equal(data.chat?.whatsapp.endsWith("a%20tattoo"), true);
	});

	test("a 422 validation_failed or a 404 from the flash read is the not-found; a 500 is an error", async () => {
		const read = (respond: () => Response) =>
			fakeFetch(({ url }) =>
				url.endsWith("/artists") ? json(200, { data: [SITA] }) : respond(),
			).fetch;
		await assert.rejects(
			loadFlashPage(pageContext(read(() => json(422, VALIDATION_FAILED))), {
				cursor: "!!",
			}),
			notFound,
		);
		await assert.rejects(
			loadFlashPage(pageContext(read(() => json(404, NOT_FOUND))), {}),
			notFound,
		);
		for (const respond of [
			() => json(500, { error: { code: "internal_error", message: "Boom." } }),
			() => {
				throw new TypeError("fetch failed");
			},
		]) {
			await assert.rejects(
				loadFlashPage(pageContext(read(respond)), {}),
				(error: unknown) =>
					error instanceof TattooApiError && !isNotFound(error),
			);
		}
	});
});

describe("the flash design page's loader (TAT-129)", () => {
	const design = flashPage(1).data[0];

	test("reads the studio, the artists and the design", async () => {
		const { calls, fetch } = listing(
			[SITA, ARJUN],
			EMPTY_PAGE,
			EMPTY_FLASH_PAGE,
			design,
		);

		const data = await loadFlashDesignPage(
			pageContext(fetch, STUDIO, IMAGE_ORIGIN),
			flashId(1),
		);

		assert.deepEqual(calls.map((call) => call.url).sort(), [
			`${IMAGE_ORIGIN}/api/v1/tenants/${STUDIO.slug}/artists`,
			`${IMAGE_ORIGIN}/api/v1/tenants/${STUDIO.slug}/flash/${flashId(1)}`,
		]);
		assert.deepEqual(
			data,
			flashDesignPageData(STUDIO, [SITA, ARJUN], design, ORIGIN, IMAGE_ORIGIN),
		);
		assert.equal(data?.design.name, "Moth");
		assert.equal(data.closedNote, null);
		assert.equal(data.seo.canonical, `${ORIGIN}/flash/${flashId(1)}`);
		assert.ok(data.chat?.whatsapp.includes("the%20Moth%20flash"));
	});

	test("a design that can't be requested carries the artist's words, else ours", async () => {
		const closed = {
			...design,
			requestable: false,
			artist: { slug: "arjun", name: "अर्जुन थापा" },
		};
		const other = { ...design, requestable: false };

		const arjun = flashDesignPageData(
			STUDIO,
			[SITA, ARJUN],
			closed,
			ORIGIN,
			IMAGE_ORIGIN,
		);
		const sita = flashDesignPageData(
			STUDIO,
			[SITA, ARJUN],
			other,
			ORIGIN,
			IMAGE_ORIGIN,
		);

		assert.equal(arjun?.closedNote, "Books open in March.");
		assert.equal(sita?.closedNote, "Not taking flash requests right now");
	});

	test("an unknown design is the not-found; a malformed id is the not-found with no API call", async () => {
		const unknown = listing();
		await assert.rejects(
			loadFlashDesignPage(pageContext(unknown.fetch), flashId(9)),
			notFound,
		);

		for (const id of [
			"NOT-A-UUID",
			flashId(1).toUpperCase(),
			"../artists",
			"",
		]) {
			const { calls, fetch } = listing();
			await assert.rejects(
				loadFlashDesignPage(pageContext(fetch), id),
				notFound,
			);
			assert.deepEqual(calls, [], id);
		}
	});

	test("a design the page can't show is the not-found too", async () => {
		const { fetch } = listing([SITA], EMPTY_PAGE, EMPTY_FLASH_PAGE, {
			...design,
			name: "",
		});
		await assert.rejects(
			loadFlashDesignPage(pageContext(fetch, STUDIO, IMAGE_ORIGIN), flashId(1)),
			notFound,
		);
	});
});
