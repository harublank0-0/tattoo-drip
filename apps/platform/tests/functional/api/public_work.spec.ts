import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import type ArtistWorkPhoto from "#modules/artists/models/artist_work_photo";
import ArtistService from "#modules/artists/services/artist_service";
import { encodeWorkCursor } from "#modules/artists/work_cursor";
import ImageService from "#modules/media/services/image_service";
import { CURSOR_MESSAGE } from "#modules/storefront/validators/work";
import type Tenant from "#modules/tenancy/models/tenant";
import TenancyService from "#modules/tenancy/services/tenancy_service";
import {
	assertApiError,
	assertApiHeaders,
	assertNoCookies,
} from "#tests/helpers/api";
import { addArtist, addWorkPhoto } from "#tests/helpers/artists";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

const CACHED = "public, max-age=60, stale-while-revalidate=600";
const images = new ImageService();
const tenancy = new TenancyService();

/** The documented fields (openapi.yaml, GalleryPhoto, WorkFilters). A new one needs the contract and a ruling first. */
const BODY_FIELDS = ["data", "filters", "nextCursor"];
const PHOTO_FIELDS = [
	"alt",
	"artist",
	"healed",
	"height",
	"styles",
	"url",
	"variants",
	"width",
];

const T0 = DateTime.fromISO("2026-10-01T10:00:00.000Z", { zone: "utc" });
/** A fixed time `minutes` after T0: photos are listed newest first, so a higher number is newer. */
const at = (minutes: number) => T0.plus({ minutes });

const work = (slug: string, query = "") =>
	`/api/v1/tenants/${slug}/work${query}`;

/** The stored keys of the photos in a page, in order: a photo's URL ends in its key. */
const keysOf = (data: { url: string }[]) =>
	data.map((photo) => new URL(photo.url).pathname.replace(/^\/uploads\//, ""));

function rowKeys(rows: ArtistWorkPhoto[]) {
	return rows.map((row) => row.imageKey);
}

/** Rows newest first, as the gallery lists them: created_at, then id, descending. */
function newestFirst(rows: ArtistWorkPhoto[]) {
	return [...rows].sort((a, b) => {
		const byTime = b.createdAt.toMillis() - a.createdAt.toMillis();
		return byTime !== 0 ? byTime : b.id.localeCompare(a.id);
	});
}

function changeSlug(tenant: Tenant, slug: string) {
	return inTenant(tenant, () => tenancy.changeSlug(tenant, slug));
}

test.group("GET /api/v1/tenants/:tenant/work (listWork)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("lists every visible artist's photos newest first with exactly the documented fields", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("api-work-126a");
		const sita = await addArtist(tenant, owner);
		const bina = await addArtist(tenant, owner, { name: "Bina", slug: "bina" });
		const [first, second, third] = await inTenant(tenant, async () => [
			await addWorkPhoto(tenant, sita, {
				createdAt: at(1),
				alt: "Koi on the forearm",
				// Stored out of the list's order: they come out in it.
				styles: ["realism", "blackwork"],
				healed: true,
			}),
			await addWorkPhoto(tenant, bina, { createdAt: at(3), width: 300 }),
			await addWorkPhoto(tenant, sita, { createdAt: at(2) }),
		]);

		const response = await client.get(work("api-work-126a"));

		response.assertStatus(200);
		assertApiHeaders(response);
		const body = response.body();
		assert.deepEqual(Object.keys(body).sort(), BODY_FIELDS);
		assert.deepEqual(keysOf(body.data), rowKeys([second, third, first]));
		assert.isNull(body.nextCursor);
		assert.deepEqual(Object.keys(body.filters).sort(), ["healed", "styles"]);
		assert.deepEqual(body.filters, {
			styles: [
				{ slug: "blackwork", name: "Blackwork" },
				{ slug: "realism", name: "Realism" },
			],
			healed: true,
		});
		for (const photo of body.data) {
			assert.deepEqual(Object.keys(photo).sort(), PHOTO_FIELDS);
			assert.deepEqual(Object.keys(photo.artist).sort(), ["name", "slug"]);
			assert.match(
				new URL(photo.url).pathname,
				new RegExp(`^/uploads/tenants/${tenant.id}/artist_work_photo/`),
			);
			for (const variant of photo.variants) {
				assert.deepEqual(Object.keys(variant).sort(), ["url", "width"]);
			}
		}
		const [newest, middle, oldest] = body.data;
		assert.deepEqual(newest.artist, { slug: "bina", name: "Bina" });
		assert.equal(newest.width, 300);
		assert.deepEqual(middle.artist, { slug: "sita", name: "Sita Rai" });
		assert.isNull(middle.alt);
		assert.deepEqual(middle.styles, []);
		assert.isFalse(middle.healed);
		assert.equal(oldest.alt, "Koi on the forearm");
		assert.isTrue(oldest.healed);
		assert.deepEqual(oldest.styles, [
			{ slug: "blackwork", name: "Blackwork" },
			{ slug: "realism", name: "Realism" },
		]);
		for (const style of oldest.styles) {
			assert.deepEqual(Object.keys(style).sort(), ["name", "slug"]);
		}
		assert.deepEqual(
			oldest.variants.map((variant: { width: number }) => variant.width),
			[320, 640, 1280],
		);
		// Never the row: no id, key column, artist id, tenant id or timestamp.
		const text = JSON.stringify(body);
		for (const word of [
			"created",
			"updated",
			"artistId",
			"artist_id",
			"tenantId",
			"tenant_id",
			"imageKey",
			"image_key",
			"cursor_at",
			"position",
		]) {
			assert.notInclude(text, word);
		}
		for (const row of [first, second, third]) assert.notInclude(text, row.id);
		for (const artist of [sita, bina]) assert.notInclude(text, artist.id);
	});

	test("a closed artist's photos are listed; a hidden or deleted artist's are in no page, no filter and no artist= answer", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("api-work-126b");
		const closed = await addArtist(tenant, owner, {
			name: "Closed",
			slug: "closed",
			acceptingInquiries: false,
			closedMessage: "Books open in March.",
		});
		const hidden = await addArtist(tenant, owner, {
			name: "Hidden",
			slug: "hidden",
			visible: false,
		});
		const gone = await addArtist(tenant, owner, { name: "Gone", slug: "gone" });
		const [shown] = await inTenant(tenant, async () => [
			await addWorkPhoto(tenant, closed, {
				createdAt: at(1),
				styles: ["realism"],
			}),
			await addWorkPhoto(tenant, hidden, {
				createdAt: at(2),
				styles: ["cover-up"],
				healed: true,
			}),
			await addWorkPhoto(tenant, gone, {
				createdAt: at(3),
				styles: ["japanese"],
				healed: true,
			}),
		]);
		await inTenant(tenant, () =>
			new ArtistService(images).delete(tenant, gone),
		);

		const all = (await client.get(work("api-work-126b"))).body();
		const hiddenOnly = await client.get(
			work("api-work-126b", "?artist=hidden"),
		);
		const goneOnly = await client.get(work("api-work-126b", "?artist=gone"));
		const hiddenStyle = await client.get(
			work("api-work-126b", "?style=cover-up"),
		);

		assert.deepEqual(keysOf(all.data), [shown.imageKey]);
		assert.deepEqual(all.data[0].artist, { slug: "closed", name: "Closed" });
		// Only the visible artist's style, and no healed mark: theirs is not healed.
		assert.deepEqual(all.filters, {
			styles: [{ slug: "realism", name: "Realism" }],
			healed: false,
		});
		const empty = {
			data: [],
			nextCursor: null,
			filters: { styles: [], healed: false },
		};
		hiddenOnly.assertStatus(200);
		assert.deepEqual(hiddenOnly.body(), empty);
		assert.deepEqual(goneOnly.body(), empty);
		assert.deepEqual(hiddenStyle.body().data, []);
		const text = JSON.stringify(all);
		assert.notInclude(text, "Hidden");
		assert.notInclude(text, "Gone");
		assert.notInclude(text, "cover-up");
	});

	test("pages by cursor: limit 2 over 5 photos gives 2, 2 and 1, the last with nextCursor null", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("api-work-126c");
		const sita = await addArtist(tenant, owner);
		// The second and third share an instant, across the first page's edge.
		const rows = await inTenant(tenant, async () => [
			await addWorkPhoto(tenant, sita, { createdAt: at(5) }),
			await addWorkPhoto(tenant, sita, { createdAt: at(4) }),
			await addWorkPhoto(tenant, sita, { createdAt: at(4) }),
			await addWorkPhoto(tenant, sita, { createdAt: at(2) }),
			await addWorkPhoto(tenant, sita, { createdAt: at(1) }),
		]);
		const expected = rowKeys(newestFirst(rows));

		const first = (await client.get(work("api-work-126c", "?limit=2"))).body();
		assert.lengthOf(first.data, 2);
		assert.isString(first.nextCursor);
		const second = (
			await client.get(
				work(
					"api-work-126c",
					`?limit=2&cursor=${encodeURIComponent(first.nextCursor)}`,
				),
			)
		).body();
		assert.lengthOf(second.data, 2);
		assert.isString(second.nextCursor);
		const third = (
			await client.get(
				work(
					"api-work-126c",
					`?limit=2&cursor=${encodeURIComponent(second.nextCursor)}`,
				),
			)
		).body();

		assert.lengthOf(third.data, 1);
		assert.isNull(third.nextCursor);
		// Every photo once, in order, and the filters are the same on each page.
		assert.deepEqual(
			[...keysOf(first.data), ...keysOf(second.data), ...keysOf(third.data)],
			expected,
		);
		assert.deepEqual(second.filters, first.filters);
		assert.deepEqual(third.filters, first.filters);
	});

	test("a page is 24 photos unless limit says otherwise, up to 48", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("api-work-126d");
		const sita = await addArtist(tenant, owner);
		await inTenant(tenant, async () => {
			for (let n = 0; n < 26; n++) {
				await addWorkPhoto(tenant, sita, { createdAt: at(n) });
			}
		});

		const byDefault = (await client.get(work("api-work-126d"))).body();
		const widest = (
			await client.get(work("api-work-126d", "?limit=48"))
		).body();
		const one = (await client.get(work("api-work-126d", "?limit=1"))).body();

		assert.lengthOf(byDefault.data, 24);
		assert.isString(byDefault.nextCursor);
		assert.lengthOf(widest.data, 26);
		assert.isNull(widest.nextCursor);
		assert.lengthOf(one.data, 1);
		assert.isString(one.nextCursor);
	});

	test("filters by artist, style and healed, and they combine; an unknown style is an empty page with the usual filters", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("api-work-126e");
		const sita = await addArtist(tenant, owner);
		const bina = await addArtist(tenant, owner, { name: "Bina", slug: "bina" });
		const [a, b, c, d] = await inTenant(tenant, async () => [
			await addWorkPhoto(tenant, sita, {
				createdAt: at(1),
				styles: ["realism"],
				healed: true,
			}),
			await addWorkPhoto(tenant, sita, {
				createdAt: at(2),
				styles: ["realism", "japanese"],
			}),
			await addWorkPhoto(tenant, bina, {
				createdAt: at(3),
				styles: ["realism"],
				healed: true,
			}),
			await addWorkPhoto(tenant, bina, { createdAt: at(4), styles: [] }),
		]);
		const keysFor = async (query: string) =>
			keysOf((await client.get(work("api-work-126e", query))).body().data);

		assert.deepEqual(await keysFor(""), rowKeys([d, c, b, a]));
		assert.deepEqual(await keysFor("?artist=bina"), rowKeys([d, c]));
		assert.deepEqual(await keysFor("?style=realism"), rowKeys([c, b, a]));
		assert.deepEqual(await keysFor("?style=japanese"), rowKeys([b]));
		assert.deepEqual(await keysFor("?healed=true"), rowKeys([c, a]));
		assert.deepEqual(
			await keysFor("?artist=sita&style=realism&healed=true"),
			rowKeys([a]),
		);
		assert.deepEqual(await keysFor("?artist=bina&style=japanese"), []);

		// An artist's filters are their own photos': bina has no japanese one.
		const binaPage = (
			await client.get(work("api-work-126e", "?artist=bina"))
		).body();
		assert.deepEqual(binaPage.filters, {
			styles: [{ slug: "realism", name: "Realism" }],
			healed: true,
		});
		// Nothing matches: an empty page, but the filters stay the studio's.
		const unknown = (
			await client.get(work("api-work-126e", "?style=no-such-style"))
		).body();
		assert.deepEqual(unknown, {
			data: [],
			nextCursor: null,
			filters: {
				styles: [
					{ slug: "realism", name: "Realism" },
					{ slug: "japanese", name: "Japanese" },
				],
				healed: true,
			},
		});
		const nobody = (
			await client.get(work("api-work-126e", "?artist=nobody"))
		).body();
		assert.deepEqual(nobody, {
			data: [],
			nextCursor: null,
			filters: { styles: [], healed: false },
		});
	});

	test("healed=false is the same as leaving healed out: every photo, never only the unhealed", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("api-work-126f");
		const sita = await addArtist(tenant, owner);
		await inTenant(tenant, async () => {
			await addWorkPhoto(tenant, sita, { createdAt: at(1), healed: true });
			await addWorkPhoto(tenant, sita, { createdAt: at(2), healed: false });
		});

		const left = await client.get(work("api-work-126f"));
		const falsy = await client.get(work("api-work-126f", "?healed=false"));
		const onlyHealed = await client.get(work("api-work-126f", "?healed=true"));

		falsy.assertStatus(200);
		assert.lengthOf(falsy.body().data, 2);
		assert.deepEqual(falsy.body(), left.body());
		assert.lengthOf(onlyHealed.body().data, 1);
		assert.isTrue(onlyHealed.body().data[0].healed);
	});

	test("a style that left the list is dropped from the photo and from the filters, and filters nothing", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("api-work-126g");
		const sita = await addArtist(tenant, owner);
		await inTenant(tenant, () =>
			addWorkPhoto(tenant, sita, { styles: ["realism", "retired-style"] }),
		);

		const body = (await client.get(work("api-work-126g"))).body();
		const retired = (
			await client.get(work("api-work-126g", "?style=retired-style"))
		).body();

		assert.deepEqual(body.data[0].styles, [
			{ slug: "realism", name: "Realism" },
		]);
		assert.deepEqual(body.filters.styles, [
			{ slug: "realism", name: "Realism" },
		]);
		assert.notInclude(JSON.stringify(body), "retired");
		assert.deepEqual(retired.data, []);
		assert.isNull(retired.nextCursor);
		assert.deepEqual(retired.filters, body.filters);
	});

	test("a malformed cursor, artist, style, healed or limit is validation_failed with that field", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("api-work-126h");
		const sita = await addArtist(tenant, owner);
		await inTenant(tenant, () => addWorkPhoto(tenant, sita));
		const validCursor = encodeWorkCursor({
			at: "2026-10-01T10:00:00.000000Z",
			id: "00000000-0000-4000-8000-000000000000",
		});
		const cases: [query: string, field: string][] = [
			["cursor=!!", "cursor"],
			// Base64url of "x~y": the right alphabet, not a cursor.
			[`cursor=${Buffer.from("x~y").toString("base64url")}`, "cursor"],
			// A cursor for a month 13, and one past the longest a cursor can be.
			[
				`cursor=${encodeWorkCursor({ at: "2026-13-01T10:00:00.000000Z", id: "00000000-0000-4000-8000-000000000000" })}`,
				"cursor",
			],
			[`cursor=${validCursor}${"A".repeat(200)}`, "cursor"],
			["cursor=", "cursor"],
			["artist=Sita", "artist"],
			["artist=s", "artist"],
			["artist=-sita", "artist"],
			["style=Fine%20line", "style"],
			["style=fine--line", "style"],
			["style=%00", "style"],
			[`style=${"a".repeat(41)}`, "style"],
			["healed=maybe", "healed"],
			["limit=0", "limit"],
			["limit=49", "limit"],
			["limit=-1", "limit"],
			["limit=1.5", "limit"],
			["limit=many", "limit"],
			["limit=", "limit"],
			["artist=sita&artist=bina", "artist"],
		];

		for (const [query, field] of cases) {
			const response = await client.get(work("api-work-126h", `?${query}`));
			assertApiError(response, 422, "validation_failed");
			assert.property(response.body().error.fields, field, query);
			assert.deepEqual(
				Object.keys(response.body().error.fields),
				[field],
				query,
			);
		}
	});

	test("a cursor of the right shape that no page produced says how to pass one", async ({
		client,
		assert,
	}) => {
		await studioWithOwner("api-work-126i");

		for (const cursor of [
			Buffer.from("x~y").toString("base64url"),
			"!!",
			"A".repeat(201),
		]) {
			const response = await client.get(
				work("api-work-126i", `?cursor=${cursor}`),
			);
			assertApiError(response, 422, "validation_failed");
			assert.deepEqual(response.body().error.fields, {
				cursor: [CURSOR_MESSAGE],
			});
		}
	});

	test("is cacheable: public, an ETag and a 304; HEAD the same", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("api-work-126j");
		const sita = await addArtist(tenant, owner);
		await inTenant(tenant, () => addWorkPhoto(tenant, sita));
		const url = work("api-work-126j", "?limit=5");

		const first = await client.get(url);
		first.assertHeader("cache-control", CACHED);
		const etag = first.header("etag") ?? "";
		assert.isNotEmpty(etag);

		const again = await client.get(url).header("if-none-match", etag);
		again.assertStatus(304);
		assertNoCookies(again);
		const head = await client.head(url);
		head.assertStatus(200);
		head.assertHeader("cache-control", CACHED);
		head.assertHeader("etag", etag);
		// A refused query is never cacheable.
		const refused = await client.get(work("api-work-126j", "?limit=0"));
		refused.assertHeader("cache-control", "no-store");
		assert.isUndefined(refused.header("etag"));
	});

	test("a new photo changes the ETag", async ({ client, assert }) => {
		const { owner, tenant } = await studioWithOwner("api-work-126k");
		const sita = await addArtist(tenant, owner);
		const url = work("api-work-126k");
		const before = (await client.get(url)).header("etag");

		await inTenant(tenant, () => addWorkPhoto(tenant, sita));
		const after = (await client.get(url)).header("etag");

		assert.notEqual(before, after);
	});

	test("under an old studio slug, answers like under the current one", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("api-work-126l");
		const sita = await addArtist(tenant, owner);
		await inTenant(tenant, () =>
			addWorkPhoto(tenant, sita, { styles: ["realism"] }),
		);
		await changeSlug(tenant, "api-work-126m");

		const old = await client.get(work("api-work-126l"));
		const current = await client.get(work("api-work-126m"));

		old.assertStatus(200);
		assert.lengthOf(current.body().data, 1);
		assert.deepEqual(old.body(), current.body());
	});

	test("an unknown studio is a 404 and a POST a 405, both no-store", async ({
		client,
	}) => {
		await studioWithOwner("api-work-126n");

		const unknown = await client.get(work("no-such-studio-td126"));
		assertApiError(unknown, 404, "not_found");
		const post = await client.post(work("api-work-126n")).json({});
		assertApiError(post, 405, "method_not_allowed");
		post.assertHeader("allow", "GET, HEAD");
	});

	test("another studio's artist slug is no match", async ({
		client,
		assert,
	}) => {
		const mine = await studioWithOwner("api-work-126o");
		const theirs = await studioWithOwner("api-work-126p");
		const theirSita = await addArtist(theirs.tenant, theirs.owner, {
			name: "Theirs",
			slug: "theirs",
		});
		await addArtist(mine.tenant, mine.owner);
		await inTenant(theirs.tenant, () =>
			addWorkPhoto(theirs.tenant, theirSita, { styles: ["realism"] }),
		);

		const body = (
			await client.get(work("api-work-126o", "?artist=theirs"))
		).body();

		assert.deepEqual(body, {
			data: [],
			nextCursor: null,
			filters: { styles: [], healed: false },
		});
	});
});
