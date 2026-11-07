import testUtils from "@adonisjs/core/services/test_utils";
import db from "@adonisjs/lucid/services/db";
import type { ApiResponse } from "@japa/api-client";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import type Artist from "#modules/artists/models/artist";
import { verifyReferral } from "#modules/discovery/referral";
import type Tenant from "#modules/tenancy/models/tenant";
import TenancyService from "#modules/tenancy/services/tenancy_service";
import { dbClient } from "#services/db_context";
import { assertApiError } from "#tests/helpers/api";
import { fillApiLimit } from "#tests/helpers/api_limits";
import { addArtist, addWorkPhoto } from "#tests/helpers/artists";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

/**
 * Discover D09 against PostgreSQL: the gallery's search (`q` on
 * `/discover/tattoos`: alt text, artist, studio and style names) and the
 * artwork page's detail read (`/discover/tattoos/:id`, with
 * `artistAcceptingInquiries` and the booking link that names the photo).
 * Fixtures are written in each studio's context; the reads go through the
 * D02 views with no context, as in discover.spec.ts.
 */

const T0 = DateTime.fromISO("2026-10-01T10:00:00.000Z", { zone: "utc" });
const at = (minutes: number) => T0.plus({ minutes });
const ids = (response: ApiResponse) =>
	response.body().data.map((row: { id: string }) => row.id);
const text = (response: ApiResponse) => JSON.stringify(response.body());

async function list(tenant: Tenant, city = "kathmandu") {
	await inTenant(tenant, () =>
		dbClient().rawQuery(
			`update tenants set discovery_listed = true, discovery_listed_at = ?,
			 place_id = (select id from places where country_code = 'NP' and slug = ?)
			 where id = ?`,
			[T0.toJSDate(), city, tenant.id],
		),
	);
}

async function setTenant(tenant: Tenant, sql: string) {
	await inTenant(tenant, () =>
		dbClient().rawQuery(`update tenants set ${sql} where id = ?`, [tenant.id]),
	);
}

async function setArtist(tenant: Tenant, artist: Artist, sql: string) {
	await inTenant(tenant, () =>
		dbClient().rawQuery(`update artists set ${sql} where id = ?`, [artist.id]),
	);
}

async function setPhoto(tenant: Tenant, id: string, sql: string) {
	await inTenant(tenant, () =>
		dbClient().rawQuery(`update artist_work_photos set ${sql} where id = ?`, [
			id,
		]),
	);
}

/**
 * Two listed studios (Kathmandu, Pokhara), one artist not taking requests,
 * a listed independent artist, and a never-listed studio whose photo's alt
 * text would match every search.
 */
async function world() {
	const needle = await studioWithOwner("gal-black-needle", "Black Needle");
	await list(needle.tenant);
	const sita = await addArtist(needle.tenant, needle.owner, {
		name: "Sita Rai",
		slug: "sita",
		styles: ["blackwork", "fine-line"],
	});
	const bina = await addArtist(needle.tenant, needle.owner, {
		name: "Bina Tamang",
		slug: "bina",
		styles: ["realism"],
		acceptingInquiries: false,
	});
	const [koi, swallow, tiger] = await inTenant(needle.tenant, async () => [
		await addWorkPhoto(needle.tenant, sita, {
			createdAt: at(10),
			styles: ["blackwork"],
			alt: "Koi on the forearm",
			healed: true,
		}),
		await addWorkPhoto(needle.tenant, sita, {
			createdAt: at(30),
			styles: ["fine-line"],
		}),
		await addWorkPhoto(needle.tenant, bina, {
			createdAt: at(20),
			styles: ["realism"],
			alt: "Portrait of a tiger",
		}),
	]);

	const lotus = await studioWithOwner("gal-lotus-ink", "Lotus Ink");
	await list(lotus.tenant, "pokhara");
	const ram = await addArtist(lotus.tenant, lotus.owner, {
		name: "Ram Thapa",
		slug: "ram",
		styles: ["japanese"],
	});
	const dragon = await inTenant(lotus.tenant, () =>
		addWorkPhoto(lotus.tenant, ram, {
			createdAt: at(40),
			styles: ["japanese"],
			alt: "Dragon sleeve, 100%_done",
		}),
	);

	const { owner } = await studioWithOwner("gal-solo-owner", "Solo Owner");
	const solo = await new TenancyService().createTenant(owner, {
		type: "independent",
		name: "Asha Solo",
		slug: "gal-asha-solo",
		timezone: "Asia/Kathmandu",
	});
	await list(solo, "lalitpur");
	const asha = await addArtist(solo, owner, {
		name: "Asha Gurung",
		slug: "asha",
		styles: ["dotwork"],
	});
	const mandala = await inTenant(solo, () =>
		addWorkPhoto(solo, asha, {
			createdAt: at(50),
			styles: ["dotwork"],
			alt: "Dotwork mandala",
		}),
	);

	// Never listed: published on its own site only. Its alt text names every search.
	const unlisted = await studioWithOwner("gal-unlisted", "Unlisted Koi Ink");
	const ghost = await addArtist(unlisted.tenant, unlisted.owner, {
		name: "Ghost Sita",
		slug: "ghost",
		styles: ["blackwork"],
	});
	const ghostPhoto = await inTenant(unlisted.tenant, () =>
		addWorkPhoto(unlisted.tenant, ghost, {
			createdAt: at(60),
			styles: ["blackwork"],
			alt: "Koi Sita Ink Fine line tiger dragon",
		}),
	);

	return {
		needle,
		lotus,
		solo,
		unlisted,
		artists: { sita, bina, ram, asha, ghost },
		photos: { koi, swallow, tiger, dragon, mandala, ghostPhoto },
	};
}

const search = (client: { get: (path: string) => unknown }, qs: string) =>
	client.get(`/api/v1/discover/tattoos?${qs}`) as Promise<ApiResponse>;

test.group("Discover API D09: gallery search", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("q matches alt text, artist, studio and style names, case-insensitively and literally", async ({
		client,
		assert,
	}) => {
		const { photos } = await world();

		// The photo's own words.
		assert.deepEqual(ids(await search(client, "q=KOI")), [photos.koi.id]);
		// The artist's name: every photo of theirs, newest first.
		assert.deepEqual(ids(await search(client, "q=sita")), [
			photos.swallow.id,
			photos.koi.id,
		]);
		// The studio's name, and an independent artist's business name.
		assert.deepEqual(ids(await search(client, "q=lotus%20ink")), [
			photos.dragon.id,
		]);
		assert.deepEqual(ids(await search(client, "q=asha%20solo")), [
			photos.mandala.id,
		]);
		// A style's name (not its slug's spelling only): "Fine line".
		assert.deepEqual(ids(await search(client, "q=fine%20LINE")), [
			photos.swallow.id,
		]);
		// `%` and `_` are literal, never patterns.
		assert.deepEqual(ids(await search(client, "q=100%25_")), [
			photos.dragon.id,
		]);
		assert.deepEqual(ids(await search(client, "q=__")), []);
		assert.deepEqual(ids(await search(client, "q=%25%25")), []);
		// Surrounding spaces are trimmed.
		assert.deepEqual(ids(await search(client, "q=%20%20tiger%20")), [
			photos.tiger.id,
		]);
	});

	test("no match is an empty page, not an error, and never a hidden studio's photo", async ({
		client,
		assert,
	}) => {
		const { photos } = await world();
		const none = await search(client, "q=nothing-like-this");
		none.assertStatus(200);
		assert.deepEqual(none.body(), { data: [], nextCursor: null });
		// The never-listed studio's alt text names all of these: none shows it.
		for (const q of ["koi", "sita", "ink", "tiger", "dragon", "fine"]) {
			const response = await search(client, `q=${q}`);
			response.assertStatus(200);
			assert.notInclude(text(response), photos.ghostPhoto.id, q);
			assert.notInclude(text(response), "Unlisted", q);
			assert.notInclude(text(response), "Ghost", q);
		}
	});

	test("q combines with country, city, style, studio, artist and healed", async ({
		client,
		assert,
	}) => {
		const { artists, photos } = await world();
		assert.deepEqual(ids(await search(client, "q=sita&style=blackwork")), [
			photos.koi.id,
		]);
		assert.deepEqual(ids(await search(client, "q=sita&healed=true")), [
			photos.koi.id,
		]);
		assert.deepEqual(
			ids(await search(client, "q=ink&country=np&city=pokhara")),
			[photos.dragon.id],
		);
		assert.deepEqual(
			ids(await search(client, "q=sita&country=NP&city=pokhara")),
			[],
		);
		assert.deepEqual(
			ids(await search(client, "q=needle&studio=gal-black-needle")),
			[photos.swallow.id, photos.tiger.id, photos.koi.id],
		);
		// Another studio's artist under this studio's filter: nothing.
		assert.deepEqual(
			ids(await search(client, "q=ram&studio=gal-black-needle")),
			[],
		);
		assert.deepEqual(
			ids(await search(client, `q=sita&artist=${artists.bina.id}`)),
			[],
		);
		assert.deepEqual(
			ids(await search(client, `q=tiger&artist=${artists.bina.id}`)),
			[photos.tiger.id],
		);
	});

	test("the country is a filter on the search too", async ({
		client,
		assert,
	}) => {
		const { photos } = await world();
		assert.deepEqual(ids(await search(client, "q=ink&country=NP")), [
			photos.dragon.id,
		]);
		// No listed business in India: an empty page, never Nepal's photos.
		assert.deepEqual(ids(await search(client, "q=ink&country=IN")), []);
		assert.deepEqual(ids(await search(client, "country=IN")), []);
		// Malformed: a 422 on country, as for the other lists.
		assertApiError(
			await search(client, "q=ink&country=nepal"),
			422,
			"validation_failed",
		);
	});

	test("pages a search newest first with a stable order: ties by id, none twice or missed", async ({
		client,
		assert,
	}) => {
		const { needle, artists } = await world();
		// Five more of Sita's photos at one instant: the id breaks the tie.
		const same = await inTenant(needle.tenant, async () => {
			const made = [];
			for (let n = 0; n < 5; n++)
				made.push(
					await addWorkPhoto(needle.tenant, artists.sita, {
						createdAt: at(35),
						styles: ["blackwork"],
					}),
				);
			return made;
		});
		const all = await search(client, "q=sita&limit=48");
		const expected = ids(all);
		assert.lengthOf(expected, 7);
		const tied = expected.slice(0, 5);
		assert.deepEqual(
			tied,
			same.map((photo) => photo.id).sort((a, b) => (a < b ? 1 : -1)),
		);

		const seen: string[] = [];
		let cursor: string | null = null;
		let pages = 0;
		do {
			const page: ApiResponse = await client
				.get("/api/v1/discover/tattoos")
				.qs({ q: "sita", limit: 2, ...(cursor ? { cursor } : {}) });
			page.assertStatus(200);
			seen.push(...ids(page));
			cursor = page.body().nextCursor;
			pages++;
		} while (cursor && pages < 10);
		assert.deepEqual(seen, expected);
		assert.equal(pages, 4);
		// The same cursor answers the same page again (stable).
		const first = await search(client, "q=sita&limit=2");
		const again = await client
			.get("/api/v1/discover/tattoos")
			.qs({ q: "sita", limit: 2, cursor: first.body().nextCursor });
		const twice = await client
			.get("/api/v1/discover/tattoos")
			.qs({ q: "sita", limit: 2, cursor: first.body().nextCursor });
		assert.deepEqual(ids(again), ids(twice));
	});

	test("q is validated like the studios' and artists' searches", async ({
		client,
		assert,
	}) => {
		for (const q of [
			"a",
			" a ",
			"a".repeat(81),
			"ab%01cd",
			"ab%09cd",
			"ab%0Acd",
			"ab%7Fcd",
		]) {
			const response = await search(client, `q=${q}`);
			assert.equal(response.status(), 422, q);
			assertApiError(response, 422, "validation_failed");
			assert.property(response.body().error.fields, "q", q);
		}
		(await search(client, `q=${"a".repeat(80)}`)).assertStatus(200);
	});

	test("a gallery search counts against the search budget; browsing doesn't", async ({
		client,
	}) => {
		await fillApiLimit("discoverSearch", {
			kind: "anonymous",
			ip: "203.0.113.90",
		});
		assertApiError(
			await client
				.get("/api/v1/discover/tattoos?q=koi")
				.header("x-forwarded-for", "203.0.113.90"),
			429,
			"rate_limited",
		);
		(
			await client
				.get("/api/v1/discover/tattoos?style=blackwork")
				.header("x-forwarded-for", "203.0.113.90")
		).assertStatus(200);
	});

	test("a hidden or taken-down photo, a hidden or opted-out artist and an opted-out studio leave the search", async ({
		client,
		assert,
	}) => {
		const { needle, artists, photos } = await world();
		const cases: [string, () => Promise<void>, string, string][] = [
			[
				"hidden photo",
				() => setPhoto(needle.tenant, photos.koi.id, "hidden = true"),
				"koi",
				photos.koi.id,
			],
			[
				"taken-down photo",
				() =>
					setPhoto(
						needle.tenant,
						photos.koi.id,
						"discovery_suspended_at = now()",
					),
				"koi",
				photos.koi.id,
			],
			[
				"hidden artist",
				() => setArtist(needle.tenant, artists.sita, "visible = false"),
				"sita",
				photos.swallow.id,
			],
			[
				"opted-out artist",
				() =>
					setArtist(needle.tenant, artists.sita, "discovery_listed = false"),
				"sita",
				photos.swallow.id,
			],
			[
				"opted-out studio",
				() => setTenant(needle.tenant, "discovery_listed = false"),
				"needle",
				photos.tiger.id,
			],
		];
		for (const [name, change, q, id] of cases) {
			await db.rawQuery("savepoint d09_case");
			await change();
			const response = await search(client, `q=${q}`);
			response.assertStatus(200);
			assert.notInclude(text(response), id, name);
			await db.rawQuery("rollback to savepoint d09_case");
		}
	});
});

test.group("Discover API D09: one artwork", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	const DETAIL_FIELDS = [
		"artist",
		"artistAcceptingInquiries",
		"bookingUrl",
		"healed",
		"id",
		"image",
		"location",
		"storefrontUrl",
		"studio",
		"styles",
	];

	test("an eligible photo: attribution, place, image, styles and a booking link that names it", async ({
		client,
		assert,
	}) => {
		const { needle, lotus, artists, photos } = await world();
		const response = await client.get(
			`/api/v1/discover/tattoos/${photos.koi.id}`,
		);
		response.assertStatus(200);
		const tattoo = response.body().data;
		assert.deepEqual(Object.keys(tattoo).sort(), DETAIL_FIELDS);
		assert.equal(tattoo.id, photos.koi.id);
		assert.deepEqual(tattoo.artist, {
			id: artists.sita.id,
			slug: "sita",
			name: "Sita Rai",
		});
		assert.deepEqual(tattoo.studio, {
			slug: "gal-black-needle",
			name: "Black Needle",
			type: "studio",
		});
		assert.deepEqual(tattoo.location, {
			country: "NP",
			slug: "kathmandu",
			name: "Kathmandu",
			region: "Bagmati Province",
		});
		assert.deepEqual(
			tattoo.styles.map((style: { slug: string }) => style.slug),
			["blackwork"],
		);
		assert.isTrue(tattoo.healed);
		assert.isTrue(tattoo.artistAcceptingInquiries);
		assert.equal(tattoo.image.alt, "Koi on the forearm");
		assert.match(tattoo.image.url, /^https?:\/\//);
		assert.isArray(tattoo.image.variants);
		assert.isAbove(tattoo.image.width, 0);
		assert.isAbove(tattoo.image.height, 0);

		// The booking link: the studio site's /book with exactly the photo and
		// the referral, on the same origin as the photo's page there.
		const booking = new URL(tattoo.bookingUrl);
		const page = new URL(tattoo.storefrontUrl);
		assert.equal(booking.origin, page.origin);
		assert.include(booking.hostname, "gal-black-needle");
		assert.equal(booking.pathname, "/book");
		assert.deepEqual([...booking.searchParams.keys()].sort(), [
			"artwork",
			"ref",
		]);
		assert.equal(booking.searchParams.get("artwork"), photos.koi.id);
		const ref = booking.searchParams.get("ref");
		assert.isTrue(verifyReferral(ref, needle.tenant.id).valid);
		// Bound to this studio: worthless at another.
		assert.isFalse(verifyReferral(ref, lotus.tenant.id).valid);
		assert.equal(page.pathname, `/gallery/${photos.koi.id}`);
	});

	test("an artist who isn't taking requests: false, and the link still names the photo", async ({
		client,
		assert,
	}) => {
		const { photos } = await world();
		const tattoo = (
			await client.get(`/api/v1/discover/tattoos/${photos.tiger.id}`)
		).body().data;
		assert.isFalse(tattoo.artistAcceptingInquiries);
		assert.equal(
			new URL(tattoo.bookingUrl).searchParams.get("artwork"),
			photos.tiger.id,
		);
	});

	test("an independent artist's photo names their business", async ({
		client,
		assert,
	}) => {
		const { solo, photos } = await world();
		const tattoo = (
			await client.get(`/api/v1/discover/tattoos/${photos.mandala.id}`)
		).body().data;
		assert.deepEqual(tattoo.studio, {
			slug: "gal-asha-solo",
			name: "Asha Solo",
			type: "independent",
		});
		assert.equal(tattoo.location.slug, "lalitpur");
		const booking = new URL(tattoo.bookingUrl);
		assert.include(booking.hostname, "gal-asha-solo");
		assert.isTrue(
			verifyReferral(booking.searchParams.get("ref"), solo.id).valid,
		);
	});

	test("unknown, never listed, unpublished, taken down, hidden or opted-out: the same 404", async ({
		client,
		assert,
	}) => {
		const { needle, artists, photos } = await world();
		const expectGone = async (id: string, label: string) => {
			const response = await client.get(`/api/v1/discover/tattoos/${id}`);
			assertApiError(response, 404, "not_found");
			assert.notInclude(text(response), id, label);
			return response.body();
		};
		const bodies = [
			await expectGone("00000000-0000-4000-8000-000000000000", "unknown"),
			// Another tenant's photo (never listed): its id leaks nothing.
			await expectGone(photos.ghostPhoto.id, "never listed"),
		];
		const cases: [string, () => Promise<void>][] = [
			[
				"unpublished",
				() => setPhoto(needle.tenant, photos.koi.id, "hidden = true"),
			],
			[
				"taken down",
				() =>
					setPhoto(
						needle.tenant,
						photos.koi.id,
						"discovery_suspended_at = now(), discovery_suspension_note = 'internal reason'",
					),
			],
			[
				"hidden artist",
				() => setArtist(needle.tenant, artists.sita, "visible = false"),
			],
			[
				"opted-out artist",
				() =>
					setArtist(needle.tenant, artists.sita, "discovery_listed = false"),
			],
			[
				"deleted artist",
				() => setArtist(needle.tenant, artists.sita, "deleted_at = now()"),
			],
			[
				"opted-out studio",
				() => setTenant(needle.tenant, "discovery_listed = false"),
			],
			[
				"taken-down studio",
				() => setTenant(needle.tenant, "discovery_suspended_at = now()"),
			],
		];
		for (const [label, change] of cases) {
			await db.rawQuery("savepoint d09_case");
			await change();
			bodies.push(await expectGone(photos.koi.id, label));
			await db.rawQuery("rollback to savepoint d09_case");
		}
		// The same answer whatever the reason: no hint of which.
		for (const body of bodies) assert.deepEqual(body, bodies[0]);
		// …and the photo is back once the change is undone.
		(
			await client.get(`/api/v1/discover/tattoos/${photos.koi.id}`)
		).assertStatus(200);
	});

	test("cross-tenant isolation: a photo is only ever its own studio's, and a studio filter never reaches another's", async ({
		client,
		assert,
	}) => {
		const { photos } = await world();
		const dragon = (
			await client.get(`/api/v1/discover/tattoos/${photos.dragon.id}`)
		).body().data;
		assert.equal(dragon.studio.slug, "gal-lotus-ink");
		assert.include(new URL(dragon.bookingUrl).hostname, "gal-lotus-ink");
		assert.notInclude(JSON.stringify(dragon), "gal-black-needle");
		const needleOnly = await search(client, "studio=gal-black-needle&limit=48");
		assert.notInclude(ids(needleOnly), photos.dragon.id);
		assert.notInclude(ids(needleOnly), photos.ghostPhoto.id);
		assert.deepEqual(
			ids(await search(client, "studio=gal-unlisted")),
			[],
			"a never-listed studio's slug is an empty page",
		);
		// No private words in the detail.
		for (const word of [
			"tenant_id",
			"tenantId",
			"hidden",
			"suspen",
			"discovery_listed",
			"email",
		])
			assert.notInclude(JSON.stringify(dragon), word, word);
	});
});
