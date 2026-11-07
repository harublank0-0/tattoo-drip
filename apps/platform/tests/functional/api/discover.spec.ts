import testUtils from "@adonisjs/core/services/test_utils";
import db from "@adonisjs/lucid/services/db";
import type { ApiClient, ApiResponse } from "@japa/api-client";
import type { Assert } from "@japa/assert";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import type Artist from "#modules/artists/models/artist";
import { encodeDiscoverCursor } from "#modules/discovery/cursor";
import { verifyReferral } from "#modules/discovery/referral";
import type Tenant from "#modules/tenancy/models/tenant";
import TenancyService from "#modules/tenancy/services/tenancy_service";
import { dbClient } from "#services/db_context";
import { assertApiError, assertApiHeaders } from "#tests/helpers/api";
import { fillApiLimit } from "#tests/helpers/api_limits";
import { addArtist, addWorkPhoto } from "#tests/helpers/artists";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

/**
 * Discover's public API (D03, docs/discover/api.md) against PostgreSQL:
 * what it shows, what it never shows (the same 404 or absence, whatever the
 * reason), its filters, sorts and cursors, its validation and its limits.
 * Fixtures are written in each studio's context, as the app writes them;
 * the requests read through the D02 views with no context at all.
 */

const CACHED = "public, max-age=60, stale-while-revalidate=60";
const T0 = DateTime.fromISO("2026-10-01T10:00:00.000Z", { zone: "utc" });
const at = (minutes: number) => T0.plus({ minutes });

const STUDIO_FIELDS = [
	"cover",
	"id",
	"location",
	"logo",
	"name",
	"slug",
	"storefrontUrl",
	"styles",
	"type",
];
const STUDIO_DETAIL_FIELDS = [
	...STUDIO_FIELDS,
	"artists",
	"bookingUrl",
	"intro",
	"socialLinks",
	"tattoos",
	"timezone",
].sort();
const ARTIST_FIELDS = [
	"acceptingInquiries",
	"id",
	"independent",
	"location",
	"name",
	"photo",
	"slug",
	"storefrontUrl",
	"studio",
	"styles",
];
const ARTIST_DETAIL_FIELDS = [
	...ARTIST_FIELDS,
	"bio",
	"bookingUrl",
	"socialLinks",
	"tattoos",
].sort();
const TATTOO_FIELDS = ["artist", "healed", "id", "image", "studio", "styles"];
const TATTOO_DETAIL_FIELDS = [
	...TATTOO_FIELDS,
	"artistAcceptingInquiries",
	"bookingUrl",
	"location",
	"storefrontUrl",
].sort();

/** Words that name private or internal data: none may appear in any answer. */
const PRIVATE = [
	"tenant_id",
	"tenantId",
	"deleted",
	"suspen",
	"internal reason",
	"discovery_listed",
	"hidden",
	"visible",
	"owner@",
	"closedMessage",
	"linkToMe",
	"phone",
	"email",
];

/** Lists `tenant` on Discover in `city` (Nepal), from `listedAt`. */
async function list(
	tenant: Tenant,
	{
		city = "kathmandu",
		listedAt = T0,
	}: { city?: string; listedAt?: DateTime } = {},
) {
	await inTenant(tenant, () =>
		dbClient().rawQuery(
			`update tenants set discovery_listed = true, discovery_listed_at = ?,
			 place_id = (select id from places where country_code = 'NP' and slug = ?)
			 where id = ?`,
			[listedAt.toJSDate(), city, tenant.id],
		),
	);
}

async function setTenant(
	tenant: Tenant,
	sql: string,
	bindings: unknown[] = [],
) {
	await inTenant(tenant, () =>
		dbClient().rawQuery(`update tenants set ${sql} where id = ?`, [
			...bindings,
			tenant.id,
		] as never),
	);
}

async function setArtist(tenant: Tenant, artist: Artist, sql: string) {
	await inTenant(tenant, () =>
		dbClient().rawQuery(`update artists set ${sql} where id = ?`, [artist.id]),
	);
}

/** A listed studio with two shown artists and their photos, and one never-listed studio beside it. */
async function world() {
	const needle = await studioWithOwner("disc-black-needle", "Black Needle");
	await list(needle.tenant, { listedAt: at(1) });
	const sita = await addArtist(needle.tenant, needle.owner, {
		name: "Sita Rai",
		slug: "sita",
		styles: ["blackwork", "fine-line"],
		bio: "Fine lines.",
		instagramUrl: "https://instagram.com/sita",
	});
	const bina = await addArtist(needle.tenant, needle.owner, {
		name: "Bina Tamang",
		slug: "bina",
		styles: ["realism"],
	});
	const [sitaOld, sitaNew, binaPhoto] = await inTenant(
		needle.tenant,
		async () => [
			await addWorkPhoto(needle.tenant, sita, {
				createdAt: at(10),
				styles: ["blackwork"],
				alt: "Koi",
				healed: true,
			}),
			await addWorkPhoto(needle.tenant, sita, {
				createdAt: at(30),
				styles: ["fine-line"],
			}),
			await addWorkPhoto(needle.tenant, bina, {
				createdAt: at(20),
				styles: ["realism"],
			}),
		],
	);

	const lotus = await studioWithOwner("disc-lotus-ink", "Lotus Ink");
	await list(lotus.tenant, { city: "pokhara", listedAt: at(2) });
	const ram = await addArtist(lotus.tenant, lotus.owner, {
		name: "Ram Thapa",
		slug: "ram",
		styles: ["japanese"],
	});
	const ramPhoto = await inTenant(lotus.tenant, () =>
		addWorkPhoto(lotus.tenant, ram, {
			createdAt: at(40),
			styles: ["japanese"],
		}),
	);

	// Never listed: everything in it is published on its own site.
	const hidden = await studioWithOwner("disc-unlisted", "Unlisted Ink");
	const ghost = await addArtist(hidden.tenant, hidden.owner, {
		name: "Ghost Artist",
		slug: "ghost",
		styles: ["blackwork"],
	});
	const ghostPhoto = await inTenant(hidden.tenant, () =>
		addWorkPhoto(hidden.tenant, ghost, {
			createdAt: at(50),
			styles: ["blackwork"],
		}),
	);

	return {
		needle,
		lotus,
		hidden,
		artists: { sita, bina, ram, ghost },
		photos: { sitaOld, sitaNew, binaPhoto, ramPhoto, ghostPhoto },
	};
}

/** Every listed answer's body, for absence and no-leak checks. */
function text(response: ApiResponse) {
	return JSON.stringify(response.body());
}

function assertNoPrivate(
	assert: { notInclude: (a: string, b: string, m?: string) => void },
	response: ApiResponse,
) {
	const body = text(response);
	for (const word of PRIVATE) assert.notInclude(body, word, `leaks "${word}"`);
}

function assertCached(response: ApiResponse) {
	response.assertStatus(200);
	assertApiHeaders(response);
	response.assertHeader("cache-control", CACHED);
}

const slugs = (response: ApiResponse) =>
	response.body().data.map((row: { slug: string }) => row.slug);
const ids = (response: ApiResponse) =>
	response.body().data.map((row: { id: string }) => row.id);

test.group("Discover API: studios", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("lists listed studios newest first with exactly the documented fields", async ({
		client,
		assert,
	}) => {
		const { needle, lotus } = await world();

		const response = await client.get("/api/v1/discover/studios");

		assertCached(response);
		assert.deepEqual(Object.keys(response.body()).sort(), [
			"data",
			"nextCursor",
		]);
		assert.deepEqual(slugs(response), ["disc-lotus-ink", "disc-black-needle"]);
		assert.isNull(response.body().nextCursor);
		const [first, second] = response.body().data;
		assert.deepEqual(Object.keys(first).sort(), STUDIO_FIELDS);
		assert.equal(first.id, lotus.tenant.id);
		assert.equal(second.id, needle.tenant.id);
		assert.deepEqual(second.location, {
			country: "NP",
			slug: "kathmandu",
			name: "Kathmandu",
			region: "Bagmati Province",
		});
		// The styles of its shown artists, in the list's order.
		assert.deepEqual(
			second.styles.map((style: { slug: string }) => style.slug),
			["blackwork", "fine-line", "realism"],
		);
		assert.equal(second.type, "studio");
		assert.match(second.storefrontUrl, /disc-black-needle/);
		assertNoPrivate(assert, response);
	});

	test("independent artists are artists, not studios", async ({
		client,
		assert,
	}) => {
		await world();
		const { owner } = await studioWithOwner("disc-owner-solo", "Owner");
		const solo = await new TenancyService().createTenant(owner, {
			type: "independent",
			name: "Asha Solo",
			slug: "disc-asha-solo",
			timezone: "Asia/Kathmandu",
		});
		await list(solo);

		const studios = await client.get("/api/v1/discover/studios");
		assert.notInclude(slugs(studios), "disc-asha-solo");
		const independents = await client.get(
			"/api/v1/discover/artists?independent=true",
		);
		assert.deepEqual(
			independents
				.body()
				.data.map((row: { studio: { slug: string } }) => row.studio.slug),
			["disc-asha-solo"],
		);
		assert.isTrue(independents.body().data[0].independent);
		const detail = await client.get("/api/v1/discover/artists/disc-asha-solo");
		detail.assertStatus(200);
		assert.deepEqual(
			Object.keys(detail.body().data).sort(),
			ARTIST_DETAIL_FIELDS,
		);
		assertApiError(
			await client.get("/api/v1/discover/studios/disc-asha-solo"),
			404,
			"not_found",
		);
		assertApiError(
			await client.get("/api/v1/discover/artists/disc-black-needle"),
			404,
			"not_found",
		);
	});

	test("searches by name, filters by place and style, case-insensitively and literally", async ({
		client,
		assert,
	}) => {
		await world();

		assert.deepEqual(
			slugs(await client.get("/api/v1/discover/studios?q=NEEDLE")),
			["disc-black-needle"],
		);
		assert.deepEqual(
			slugs(
				await client.get("/api/v1/discover/studios?country=np&city=pokhara"),
			),
			["disc-lotus-ink"],
		);
		assert.deepEqual(
			slugs(await client.get("/api/v1/discover/studios?country=NP")),
			["disc-lotus-ink", "disc-black-needle"],
		);
		assert.deepEqual(
			slugs(await client.get("/api/v1/discover/studios?country=IN")),
			[],
		);
		assert.deepEqual(
			slugs(await client.get("/api/v1/discover/studios?style=realism")),
			["disc-black-needle"],
		);
		// No pattern syntax: % and _ are characters like any other.
		for (const q of ["%%", "__", "%' or 1=1 --", "\\\\"]) {
			const response = await client.get("/api/v1/discover/studios").qs({ q });
			response.assertStatus(200);
			assert.deepEqual(slugs(response), [], q);
		}
	});

	test("sorts by name both ways and pages with cursors, no row twice or missed", async ({
		client,
		assert,
	}) => {
		await world();
		const third = await studioWithOwner("disc-crimson", "crimson Rose");
		await list(third.tenant, { listedAt: at(3) });

		assert.deepEqual(
			slugs(await client.get("/api/v1/discover/studios?sort=name")),
			["disc-black-needle", "disc-crimson", "disc-lotus-ink"],
		);
		assert.deepEqual(
			slugs(await client.get("/api/v1/discover/studios?sort=-name")),
			["disc-lotus-ink", "disc-crimson", "disc-black-needle"],
		);

		for (const sort of ["newest", "name", "-name"]) {
			const all = slugs(
				await client.get(`/api/v1/discover/studios?sort=${sort}`),
			);
			const seen: string[] = [];
			let cursor: string | null = null;
			do {
				const response: ApiResponse = await client
					.get("/api/v1/discover/studios")
					.qs({ sort, limit: 1, ...(cursor ? { cursor } : {}) });
				response.assertStatus(200);
				seen.push(...slugs(response));
				cursor = response.body().nextCursor;
			} while (cursor);
			assert.deepEqual(seen, all, sort);
		}
	});

	test("rows that tie on the sort value page by id, none twice or missed", async ({
		client,
		assert,
	}) => {
		// Equal names under lower() and the same listing instant.
		const twins = [];
		for (const [index, name] of [
			"Twin Ink",
			"twin ink",
			"TWIN INK",
		].entries()) {
			const twin = await studioWithOwner(`disc-twin-${index}`, name);
			await list(twin.tenant, { listedAt: at(5) });
			twins.push(twin);
		}
		const twinSlugs = twins.map((twin) => twin.tenant.slug).sort();
		const page = async (
			url: string,
			params: Record<string, string> = {},
			field: "slug" | "id" = "slug",
		) => {
			const seen: string[] = [];
			let cursor: string | null = null;
			do {
				const response: ApiResponse = await client.get(url).qs({
					...params,
					limit: 1,
					...(cursor ? { cursor } : {}),
				});
				response.assertStatus(200);
				seen.push(
					...response
						.body()
						.data.map(
							(row: { slug?: string; id: string }) => row[field] ?? row.id,
						),
				);
				cursor = response.body().nextCursor;
			} while (cursor);
			return seen;
		};
		for (const sort of ["newest", "name", "-name"]) {
			const seen = await page("/api/v1/discover/studios", { sort });
			assert.lengthOf(seen, 3, sort);
			assert.sameMembers(seen, twinSlugs, sort);
		}

		// Photos taken at the same microsecond.
		const [first] = twins;
		const artist = await addArtist(first.tenant, first.owner, {
			name: "Twin Artist",
			slug: "twin",
			styles: ["blackwork"],
		});
		const photos = await inTenant(first.tenant, async () => [
			await addWorkPhoto(first.tenant, artist, { createdAt: at(6) }),
			await addWorkPhoto(first.tenant, artist, { createdAt: at(6) }),
			await addWorkPhoto(first.tenant, artist, { createdAt: at(6) }),
		]);
		const seen = await page("/api/v1/discover/tattoos", {
			studio: "disc-twin-0",
		});
		assert.lengthOf(seen, 3);
		assert.sameMembers(
			seen,
			photos.map((photo) => photo.id),
		);
		// Artists with the same name, made at the same instant, one per twin.
		const twinArtists = [artist];
		for (const twin of twins.slice(1)) {
			twinArtists.push(
				await addArtist(twin.tenant, twin.owner, {
					name: "Twin Artist",
					slug: "twin",
					styles: ["blackwork"],
				}),
			);
		}
		for (const [index, twin] of twins.entries()) {
			await inTenant(twin.tenant, () =>
				dbClient().rawQuery("update artists set created_at = ? where id = ?", [
					at(7).toJSDate(),
					twinArtists[index]?.id ?? "",
				]),
			);
		}
		for (const sort of ["newest", "name", "-name"]) {
			const seenArtists = await page(
				"/api/v1/discover/artists",
				{ sort },
				"id",
			);
			assert.lengthOf(seenArtists, 3, sort);
			assert.sameMembers(
				seenArtists,
				twinArtists.map((twinArtist) => twinArtist.id),
				sort,
			);
		}
	});

	test("a studio's profile: its artists, newest photos and a signed booking link", async ({
		client,
		assert,
	}) => {
		const { needle, photos } = await world();

		const response = await client.get(
			"/api/v1/discover/studios/disc-black-needle",
		);

		assertCached(response);
		const studio = response.body().data;
		assert.deepEqual(Object.keys(studio).sort(), STUDIO_DETAIL_FIELDS);
		assert.deepEqual(
			studio.artists.map((artist: { slug: string }) => artist.slug),
			["bina", "sita"],
		);
		for (const artist of studio.artists) {
			assert.deepEqual(Object.keys(artist).sort(), ARTIST_FIELDS);
		}
		assert.deepEqual(
			studio.tattoos.map((tattoo: { id: string }) => tattoo.id),
			[photos.sitaNew.id, photos.binaPhoto.id, photos.sitaOld.id],
		);
		for (const tattoo of studio.tattoos) {
			assert.deepEqual(Object.keys(tattoo).sort(), TATTOO_FIELDS);
		}
		const booking = new URL(studio.bookingUrl);
		assert.equal(booking.pathname, "/book");
		assert.isTrue(
			verifyReferral(booking.searchParams.get("ref"), needle.tenant.id).valid,
		);
		assertNoPrivate(assert, response);
	});

	test("a profile's ETag holds from one second to the next, so a revalidation is a 304", async ({
		client,
		assert,
	}) => {
		// Tokens change on the hour: start well clear of it.
		const intoHour = Date.now() % 3_600_000;
		if (intoHour > 3_595_000) {
			await new Promise((resolve) => setTimeout(resolve, 3_600_000 - intoHour));
		}
		const { photos } = await world();
		const urls = [
			"/api/v1/discover/studios/disc-black-needle",
			"/api/v1/discover/studios/disc-black-needle/artists/sita",
			`/api/v1/discover/tattoos/${photos.sitaOld.id}`,
		];
		const etags: [string, string][] = [];
		for (const url of urls) {
			const response = await client.get(url);
			assertCached(response);
			const etag = response.header("etag");
			assert.isString(etag, url);
			etags.push([url, etag ?? ""]);
		}
		// Past a second: a token signed to the second would change the body.
		await new Promise((resolve) => setTimeout(resolve, 1100));
		for (const [url, etag] of etags) {
			const again = await client.get(url).header("if-none-match", etag);
			again.assertStatus(304);
		}
	});

	test("an old slug still finds a listed studio", async ({
		client,
		assert,
	}) => {
		const { needle } = await world();
		await inTenant(needle.tenant, () =>
			new TenancyService().changeSlug(needle.tenant, "disc-new-needle"),
		);

		const response = await client.get(
			"/api/v1/discover/studios/disc-black-needle",
		);
		response.assertStatus(200);
		assert.equal(response.body().data.slug, "disc-new-needle");
	});

	test("a studio's artists, and one artist with their photos and booking link", async ({
		client,
		assert,
	}) => {
		const { needle, photos } = await world();

		const artists = await client.get(
			"/api/v1/discover/studios/disc-black-needle/artists",
		);
		assertCached(artists);
		assert.deepEqual(slugs(artists), ["bina", "sita"]);

		const response = await client.get(
			"/api/v1/discover/studios/disc-black-needle/artists/sita",
		);
		assertCached(response);
		const sita = response.body().data;
		assert.deepEqual(Object.keys(sita).sort(), ARTIST_DETAIL_FIELDS);
		assert.equal(sita.bio, "Fine lines.");
		assert.deepEqual(
			sita.tattoos.map((tattoo: { id: string }) => tattoo.id),
			[photos.sitaNew.id, photos.sitaOld.id],
		);
		assert.deepEqual(sita.studio, {
			slug: "disc-black-needle",
			name: "Black Needle",
			type: "studio",
		});
		const booking = new URL(sita.bookingUrl);
		assert.equal(booking.searchParams.get("artist"), "sita");
		assert.isTrue(
			verifyReferral(booking.searchParams.get("ref"), needle.tenant.id).valid,
		);
		assertNoPrivate(assert, response);
	});
});

test.group("Discover API: artists and tattoos", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("lists shown artists of listed businesses, filtered and searched", async ({
		client,
		assert,
	}) => {
		await world();

		const response = await client.get("/api/v1/discover/artists?sort=name");
		assertCached(response);
		assert.deepEqual(slugs(response), ["bina", "ram", "sita"]);
		for (const artist of response.body().data) {
			assert.deepEqual(Object.keys(artist).sort(), ARTIST_FIELDS);
		}
		assert.deepEqual(
			slugs(await client.get("/api/v1/discover/artists?q=tha")),
			["ram"],
		);
		assert.deepEqual(
			slugs(await client.get("/api/v1/discover/artists?style=fine-line")),
			["sita"],
		);
		assert.deepEqual(
			slugs(await client.get("/api/v1/discover/artists?studio=disc-lotus-ink")),
			["ram"],
		);
		assert.deepEqual(
			slugs(
				await client.get(
					"/api/v1/discover/artists?country=NP&city=kathmandu&sort=name",
				),
			),
			["bina", "sita"],
		);
		assert.deepEqual(
			slugs(
				await client.get(
					"/api/v1/discover/artists?independent=false&sort=name",
				),
			),
			["bina", "ram", "sita"],
		);
		assertNoPrivate(assert, response);
	});

	test("lists published photos newest first, filtered and paged", async ({
		client,
		assert,
	}) => {
		const { artists, photos } = await world();

		const response = await client.get("/api/v1/discover/tattoos");
		assertCached(response);
		assert.deepEqual(ids(response), [
			photos.ramPhoto.id,
			photos.sitaNew.id,
			photos.binaPhoto.id,
			photos.sitaOld.id,
		]);
		const [first] = response.body().data;
		assert.deepEqual(Object.keys(first).sort(), TATTOO_FIELDS);
		assert.deepEqual(first.artist, {
			id: artists.ram.id,
			slug: "ram",
			name: "Ram Thapa",
		});
		assert.deepEqual(Object.keys(first.image).sort(), [
			"alt",
			"height",
			"url",
			"variants",
			"width",
		]);

		assert.deepEqual(
			ids(await client.get("/api/v1/discover/tattoos?healed=true")),
			[photos.sitaOld.id],
		);
		assert.deepEqual(
			ids(await client.get("/api/v1/discover/tattoos?style=blackwork")),
			[photos.sitaOld.id],
		);
		assert.deepEqual(
			ids(
				await client.get(`/api/v1/discover/tattoos?artist=${artists.sita.id}`),
			),
			[photos.sitaNew.id, photos.sitaOld.id],
		);
		const anyCase = await client.get(
			`/api/v1/discover/tattoos?artist=${artists.sita.id.toUpperCase()}`,
		);
		anyCase.assertStatus(200);
		assert.deepEqual(
			ids(anyCase),
			[photos.sitaNew.id, photos.sitaOld.id],
			"a uuid in any case",
		);
		(
			await client.get(
				`/api/v1/discover/tattoos/${photos.sitaOld.id.toUpperCase()}`,
			)
		).assertStatus(200);
		assert.deepEqual(
			ids(await client.get("/api/v1/discover/tattoos?studio=disc-lotus-ink")),
			[photos.ramPhoto.id],
		);
		assert.deepEqual(
			ids(await client.get("/api/v1/discover/tattoos?country=NP&city=pokhara")),
			[photos.ramPhoto.id],
		);

		const first2 = await client.get("/api/v1/discover/tattoos?limit=2");
		assert.lengthOf(first2.body().data, 2);
		const next = await client
			.get("/api/v1/discover/tattoos")
			.qs({ limit: 2, cursor: first2.body().nextCursor });
		assert.deepEqual([...ids(first2), ...ids(next)], ids(response));
		assert.isNull(next.body().nextCursor);
		assertNoPrivate(assert, response);
	});

	test("one photo: where it is, its page and a booking link that names it", async ({
		client,
		assert,
	}) => {
		const { needle, photos } = await world();

		const response = await client.get(
			`/api/v1/discover/tattoos/${photos.sitaOld.id}`,
		);

		assertCached(response);
		const tattoo = response.body().data;
		assert.deepEqual(Object.keys(tattoo).sort(), TATTOO_DETAIL_FIELDS);
		assert.equal(tattoo.image.alt, "Koi");
		assert.isTrue(tattoo.healed);
		assert.equal(tattoo.location.slug, "kathmandu");
		const booking = new URL(tattoo.bookingUrl);
		assert.equal(booking.searchParams.get("artwork"), photos.sitaOld.id);
		assert.isTrue(
			verifyReferral(booking.searchParams.get("ref"), needle.tenant.id).valid,
		);
		assert.include(tattoo.storefrontUrl, photos.sitaOld.id);
	});

	test("styles are the platform's list; locations only places with a listed business", async ({
		client,
		assert,
	}) => {
		await world();

		const styles = await client.get("/api/v1/discover/styles");
		assertCached(styles);
		assert.isAbove(styles.body().data.length, 5);
		assert.deepEqual(Object.keys(styles.body().data[0]).sort(), [
			"name",
			"slug",
		]);

		const locations = await client.get("/api/v1/discover/locations");
		assertCached(locations);
		assert.deepEqual(
			locations.body().data.map((place: { slug: string }) => place.slug),
			["kathmandu", "pokhara"],
		);
	});

	test("an empty Discover answers empty lists, not errors", async ({
		client,
		assert,
	}) => {
		for (const path of ["studios", "artists", "tattoos", "locations"]) {
			const response = await client.get(`/api/v1/discover/${path}`);
			response.assertStatus(200);
			assert.deepEqual(response.body().data, [], path);
		}
	});
});

test.group("Discover API: what is never shown", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	/** Every way Discover could name `studio`, its artist and photo: each must be absent or 404. */
	async function assertGone(
		client: ApiClient,
		assert: Assert,
		{
			studio,
			artist,
			photo,
		}: { studio: string; artist?: string; photo?: string },
	) {
		for (const path of [
			`/api/v1/discover/studios/${studio}`,
			`/api/v1/discover/studios/${studio}/artists`,
			...(artist
				? [`/api/v1/discover/studios/${studio}/artists/${artist}`]
				: []),
			...(photo ? [`/api/v1/discover/tattoos/${photo}`] : []),
		]) {
			assertApiError(await client.get(path), 404, "not_found");
		}
		const lists: ApiResponse[] = [];
		for (const path of [
			"/api/v1/discover/studios",
			"/api/v1/discover/artists",
			"/api/v1/discover/tattoos",
			`/api/v1/discover/artists?studio=${studio}`,
			`/api/v1/discover/tattoos?studio=${studio}`,
		]) {
			lists.push(await client.get(path));
		}
		for (const response of lists) {
			response.assertStatus(200);
			assert.notInclude(text(response), studio);
			if (photo) assert.notInclude(text(response), photo);
		}
	}

	test("a studio that never opted in", async ({ client, assert }) => {
		const { photos, artists } = await world();
		await assertGone(client, assert, {
			studio: "disc-unlisted",
			artist: "ghost",
			photo: photos.ghostPhoto.id,
		});
		const byArtist = await client.get(
			`/api/v1/discover/tattoos?artist=${artists.ghost.id}`,
		);
		assert.deepEqual(byArtist.body().data, []);
	});

	test("a studio that opted out, was taken down or was deleted", async ({
		client,
		assert,
	}) => {
		const { needle, photos } = await world();
		const cases: [string, () => Promise<void>][] = [
			["opted out", () => setTenant(needle.tenant, "discovery_listed = false")],
			[
				"taken down",
				() =>
					setTenant(
						needle.tenant,
						"discovery_suspended_at = now(), discovery_suspension_note = 'internal reason'",
					),
			],
		];
		for (const [, change] of cases) {
			await db.rawQuery("savepoint d03_case");
			await change();
			await assertGone(client, assert, {
				studio: "disc-black-needle",
				artist: "sita",
				photo: photos.sitaOld.id,
			});
			await db.rawQuery("rollback to savepoint d03_case");
		}
	});

	test("an artist who is hidden, opted out or deleted, with their photos", async ({
		client,
		assert,
	}) => {
		const { needle, artists, photos } = await world();
		for (const change of [
			"visible = false",
			"discovery_listed = false",
			"deleted_at = now()",
		]) {
			await db.rawQuery("savepoint d03_case");
			await setArtist(needle.tenant, artists.sita, change);

			assertApiError(
				await client.get(
					"/api/v1/discover/studios/disc-black-needle/artists/sita",
				),
				404,
				"not_found",
			);
			assertApiError(
				await client.get(`/api/v1/discover/tattoos/${photos.sitaOld.id}`),
				404,
				"not_found",
			);
			const studio = await client.get(
				"/api/v1/discover/studios/disc-black-needle",
			);
			studio.assertStatus(200);
			assert.deepEqual(
				studio.body().data.artists.map((row: { slug: string }) => row.slug),
				["bina"],
				change,
			);
			assert.deepEqual(
				studio.body().data.tattoos.map((row: { id: string }) => row.id),
				[photos.binaPhoto.id],
				change,
			);
			// Their styles no longer describe the studio either.
			assert.deepEqual(
				studio.body().data.styles.map((row: { slug: string }) => row.slug),
				["realism"],
				change,
			);
			assert.notInclude(
				text(await client.get("/api/v1/discover/artists")),
				"sita",
			);
			assert.notInclude(
				text(await client.get("/api/v1/discover/tattoos")),
				photos.sitaOld.id,
			);
			await db.rawQuery("rollback to savepoint d03_case");
		}
	});

	test("a photo that is hidden or taken down", async ({ client, assert }) => {
		const { needle, photos } = await world();
		for (const change of ["hidden = true", "discovery_suspended_at = now()"]) {
			await db.rawQuery("savepoint d03_case");
			await inTenant(needle.tenant, () =>
				dbClient().rawQuery(
					`update artist_work_photos set ${change} where id = ?`,
					[photos.sitaOld.id],
				),
			);
			assertApiError(
				await client.get(`/api/v1/discover/tattoos/${photos.sitaOld.id}`),
				404,
				"not_found",
			);
			assert.notInclude(
				text(await client.get("/api/v1/discover/tattoos")),
				photos.sitaOld.id,
			);
			assert.notInclude(
				text(await client.get("/api/v1/discover/studios/disc-black-needle")),
				photos.sitaOld.id,
			);
			await db.rawQuery("rollback to savepoint d03_case");
		}
	});

	test("unknown slugs, ids and an artist at the wrong studio are the same 404", async ({
		client,
	}) => {
		const { photos } = await world();
		for (const path of [
			"/api/v1/discover/studios/disc-nobody",
			"/api/v1/discover/studios/disc-nobody/artists",
			"/api/v1/discover/studios/disc-lotus-ink/artists/sita",
			"/api/v1/discover/studios/disc-black-needle/artists/nobody",
			"/api/v1/discover/artists/disc-nobody",
			"/api/v1/discover/tattoos/00000000-0000-4000-8000-000000000000",
			`/api/v1/discover/tattoos/${photos.sitaOld.id.toUpperCase()}x`,
		]) {
			assertApiError(await client.get(path), 404, "not_found");
		}
	});

	test("reads run with no tenant or user context and leave the database unchanged", async ({
		client,
		assert,
	}) => {
		await world();
		const before = await dbClient().rawQuery(
			"select current_setting('app.tenant_id', true) as tenant, current_setting('app.user_id', true) as user_id",
		);
		await client.get("/api/v1/discover/studios/disc-black-needle");
		await client.get("/api/v1/discover/tattoos");
		const after = await dbClient().rawQuery(
			"select current_setting('app.tenant_id', true) as tenant, current_setting('app.user_id', true) as user_id, current_setting('transaction_read_only') as read_only",
		);
		assert.deepEqual(
			{ tenant: after.rows[0].tenant, user_id: after.rows[0].user_id },
			{ tenant: before.rows[0].tenant, user_id: before.rows[0].user_id },
		);
		// The read-only savepoint was rolled back: the transaction can still write.
		assert.equal(after.rows[0].read_only, "off");
	});
});

test.group("Discover API: validation and limits", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("refuses malformed filters with a 422 on the field", async ({
		client,
		assert,
	}) => {
		const refusals: [string, string][] = [
			["/api/v1/discover/studios?limit=49", "limit"],
			["/api/v1/discover/studios?limit=0", "limit"],
			["/api/v1/discover/studios?sort=popular", "sort"],
			["/api/v1/discover/studios?sort=name;drop table tenants", "sort"],
			["/api/v1/discover/studios?q=a", "q"],
			[`/api/v1/discover/studios?q=${"a".repeat(81)}`, "q"],
			["/api/v1/discover/studios?city=kathmandu", "city"],
			["/api/v1/discover/studios?country=nepal", "country"],
			["/api/v1/discover/studios?style=not-a-style", "style"],
			["/api/v1/discover/studios?cursor=nope", "cursor"],
			["/api/v1/discover/artists?independent=maybe", "independent"],
			["/api/v1/discover/tattoos?artist=not-a-uuid", "artist"],
			["/api/v1/discover/tattoos?healed=yes", "healed"],
		];
		for (const [path, field] of refusals) {
			const response = await client.get(path);
			assert.equal(response.status(), 422, path);
			assertApiError(response, 422, "validation_failed");
			assert.property(response.body().error.fields, field, path);
		}
	});

	test("a cursor of another sort, a tampered one or one with a bad date is a 422", async ({
		client,
	}) => {
		const id = "00000000-0000-4000-8000-000000000000";
		const nameCursor = encodeDiscoverCursor({ sort: "name", value: "a", id });
		const cursors = [
			[
				`/api/v1/discover/studios?cursor=${nameCursor}`,
				"newest sort, name cursor",
			],
			[
				`/api/v1/discover/studios?sort=newest&cursor=${encodeDiscoverCursor({ sort: "newest", value: "2026-02-30T00:00:00.000000Z", id })}`,
				"impossible date",
			],
			[
				`/api/v1/discover/studios?sort=name&cursor=${Buffer.from(JSON.stringify(["name", "a", "x' or 1=1"])).toString("base64url")}`,
				"bad id",
			],
			[`/api/v1/discover/studios?sort=name&cursor=${nameCursor}x`, "tampered"],
		];
		for (const [path] of cursors) {
			assertApiError(await client.get(path), 422, "validation_failed");
		}
	});

	test("over the Discover budget a caller gets a 429 with Retry-After", async ({
		client,
		assert,
	}) => {
		await fillApiLimit("discoverReads", {
			kind: "anonymous",
			ip: "203.0.113.60",
		});
		const response = await client
			.get("/api/v1/discover/styles")
			.header("x-forwarded-for", "203.0.113.60");
		assertApiError(response, 429, "rate_limited");
		assert.isAbove(Number(response.header("retry-after")), 0);
		(
			await client
				.get("/api/v1/discover/styles")
				.header("x-forwarded-for", "203.0.113.61")
		).assertStatus(200);
	});

	test("searches have their own, smaller budget", async ({ client }) => {
		await fillApiLimit("discoverSearch", {
			kind: "anonymous",
			ip: "203.0.113.62",
		});
		assertApiError(
			await client
				.get("/api/v1/discover/studios?q=ink")
				.header("x-forwarded-for", "203.0.113.62"),
			429,
			"rate_limited",
		);
		(
			await client
				.get("/api/v1/discover/studios")
				.header("x-forwarded-for", "203.0.113.62")
		).assertStatus(200);
	});
});
