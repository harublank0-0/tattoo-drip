import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import ArtistService from "#modules/artists/services/artist_service";
import { encodeWorkCursor } from "#modules/artists/work_cursor";
import type FlashDesign from "#modules/flash/models/flash_design";
import ImageService from "#modules/media/services/image_service";
import { CURSOR_MESSAGE } from "#modules/storefront/validators/work";
import TenancyService from "#modules/tenancy/services/tenancy_service";
import {
	assertApiError,
	assertApiHeaders,
	assertNoCookies,
} from "#tests/helpers/api";
import { addArtist, addFlashDesign } from "#tests/helpers/artists";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

const CACHED = "public, max-age=60, stale-while-revalidate=600";
const images = new ImageService();
const tenancy = new TenancyService();

/** The documented fields (openapi.yaml, FlashDesign, FlashFilters). A new one needs the contract and a ruling first. */
const BODY_FIELDS = ["data", "filters", "nextCursor"];
const DESIGN_FIELDS = [
	"artist",
	"id",
	"image",
	"name",
	"price",
	"requestable",
	"size",
];

const T0 = DateTime.fromISO("2026-10-01T10:00:00.000Z", { zone: "utc" });
/** A fixed time `minutes` after T0: designs are listed newest first, so a higher number is newer. */
const at = (minutes: number) => T0.plus({ minutes });

const flash = (slug: string, query = "") =>
	`/api/v1/tenants/${slug}/flash${query}`;
const design = (slug: string, id: string) =>
	`/api/v1/tenants/${slug}/flash/${id}`;

const ids = (rows: { id: string }[]) => rows.map((row) => row.id);

test.group("GET /api/v1/tenants/:tenant/flash (listFlash)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("lists every visible artist's shown designs newest first with exactly the documented fields", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("api-flash-129a");
		const sita = await addArtist(tenant, owner);
		const bina = await addArtist(tenant, owner, { name: "Bina", slug: "bina" });
		const [first, second, third] = await inTenant(tenant, async () => [
			await addFlashDesign(tenant, sita, {
				name: "Moth",
				price: 300_000,
				createdAt: at(1),
			}),
			await addFlashDesign(tenant, bina, { name: "Koi", createdAt: at(3) }),
			await addFlashDesign(tenant, sita, { name: "Lotus", createdAt: at(2) }),
		]);

		const response = await client.get(flash("api-flash-129a"));

		response.assertStatus(200);
		assertApiHeaders(response);
		const body = response.body();
		assert.deepEqual(Object.keys(body).sort(), BODY_FIELDS);
		assert.deepEqual(ids(body.data), ids([second, third, first]));
		assert.isNull(body.nextCursor);
		assert.deepEqual(Object.keys(body.filters), ["artists"]);
		assert.deepEqual(body.filters.artists, [
			{ slug: "bina", name: "Bina" },
			{ slug: "sita", name: "Sita Rai" },
		]);
		for (const item of body.data) {
			assert.deepEqual(Object.keys(item).sort(), DESIGN_FIELDS);
			assert.deepEqual(Object.keys(item.artist).sort(), ["name", "slug"]);
			assert.deepEqual(Object.keys(item.image).sort(), [
				"height",
				"url",
				"variants",
				"width",
			]);
			assert.match(
				new URL(item.image.url).pathname,
				new RegExp(`^/uploads/tenants/${tenant.id}/flash_design/`),
			);
			for (const variant of item.image.variants) {
				assert.deepEqual(Object.keys(variant).sort(), ["url", "width"]);
			}
		}
		const moth = body.data.find(
			(item: { name: string }) => item.name === "Moth",
		);
		assert.deepEqual(moth.price, {
			amount: 300000,
			currency: "NPR",
			text: "NPR 3,000",
		});
		assert.deepEqual(Object.keys(moth.price).sort(), [
			"amount",
			"currency",
			"text",
		]);
		assert.isNull(
			body.data.find((item: { name: string }) => item.name === "Koi").price,
		);
		assert.equal(moth.size, "About 3 in");
		assert.equal(
			moth.image.url,
			await images.url("flash_design", first.imageKey, tenant),
		);
		const text = JSON.stringify(body);
		// The tenant's id is in the pictures' addresses, as for every upload.
		for (const leak of [sita.id, "hidden", "createdAt", "tenantId"]) {
			assert.notInclude(text, leak);
		}
	});

	test("a design is requestable while its artist takes flash requests, books open or closed; not when their flash is off", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("api-flash-129b");
		const open = await addArtist(tenant, owner, { name: "Open", slug: "open" });
		const closed = await addArtist(tenant, owner, {
			name: "Closed",
			slug: "closed",
			acceptingInquiries: false,
		});
		const off = await addArtist(tenant, owner, {
			name: "Off",
			slug: "off",
			acceptingInquiries: false,
			acceptingFlash: false,
		});
		await inTenant(tenant, async () => {
			await addFlashDesign(tenant, open, { name: "A", createdAt: at(1) });
			await addFlashDesign(tenant, closed, { name: "B", createdAt: at(2) });
			await addFlashDesign(tenant, off, { name: "C", createdAt: at(3) });
		});

		const { data } = (await client.get(flash("api-flash-129b"))).body();

		assert.deepEqual(
			data.map((item: { name: string; requestable: boolean }) => [
				item.name,
				item.requestable,
			]),
			[
				["C", false],
				["B", true],
				["A", true],
			],
		);
	});

	test("hidden designs, and hidden or deleted artists' designs, are in no page, no filter and no design read", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("api-flash-129c");
		const shownArtist = await addArtist(tenant, owner);
		const hiddenArtist = await addArtist(tenant, owner, {
			name: "Hidden",
			slug: "hidden",
			visible: false,
		});
		const gone = await addArtist(tenant, owner, { name: "Gone", slug: "gone" });
		const [shown, , ofHidden, ofGone] = await inTenant(tenant, async () => [
			await addFlashDesign(tenant, shownArtist, { createdAt: at(1) }),
			await addFlashDesign(tenant, shownArtist, {
				name: "Secret",
				hidden: true,
				createdAt: at(2),
			}),
			await addFlashDesign(tenant, hiddenArtist, { createdAt: at(3) }),
			await addFlashDesign(tenant, gone, { createdAt: at(4) }),
		]);
		await inTenant(tenant, () =>
			new ArtistService(images).delete(tenant, gone),
		);

		const all = (await client.get(flash("api-flash-129c"))).body();
		const hiddenOnly = await client.get(
			flash("api-flash-129c", "?artist=hidden"),
		);
		const goneOnly = await client.get(flash("api-flash-129c", "?artist=gone"));

		assert.deepEqual(ids(all.data), [shown.id]);
		assert.deepEqual(all.filters.artists, [{ slug: "sita", name: "Sita Rai" }]);
		const empty = {
			data: [],
			nextCursor: null,
			filters: { artists: all.filters.artists },
		};
		assert.deepEqual(hiddenOnly.body(), empty);
		assert.deepEqual(goneOnly.body(), empty);
		const text = JSON.stringify(all);
		for (const leak of ["Hidden", "Gone", "Secret"])
			assert.notInclude(text, leak);
		for (const unseen of [ofHidden, ofGone]) {
			assertApiError(
				await client.get(design("api-flash-129c", unseen.id)),
				404,
				"not_found",
			);
		}
		const secret = await inTenant(tenant, async () =>
			addFlashDesign(tenant, shownArtist, { name: "Secret 2", hidden: true }),
		);
		assertApiError(
			await client.get(design("api-flash-129c", secret.id)),
			404,
			"not_found",
		);
	});

	test("pages by cursor: limit 2 over 5 designs gives 2, 2 and 1, the last with nextCursor null", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("api-flash-129d");
		const sita = await addArtist(tenant, owner);
		const made: FlashDesign[] = await inTenant(tenant, async () => {
			const rows: FlashDesign[] = [];
			for (let n = 0; n < 5; n++) {
				rows.push(await addFlashDesign(tenant, sita, { createdAt: at(n) }));
			}
			return rows;
		});
		const newestFirst = ids(made).reverse();

		const one = (await client.get(flash("api-flash-129d", "?limit=2"))).body();
		const two = (
			await client.get(
				flash("api-flash-129d", `?limit=2&cursor=${one.nextCursor}`),
			)
		).body();
		const three = (
			await client.get(
				flash("api-flash-129d", `?limit=2&cursor=${two.nextCursor}`),
			)
		).body();

		assert.deepEqual(ids(one.data), newestFirst.slice(0, 2));
		assert.deepEqual(ids(two.data), newestFirst.slice(2, 4));
		assert.deepEqual(ids(three.data), newestFirst.slice(4));
		assert.isString(one.nextCursor);
		assert.isNull(three.nextCursor);
		// A page is 24 designs unless limit says otherwise.
		const plain = (await client.get(flash("api-flash-129d"))).body();
		assert.lengthOf(plain.data, 5);
	});

	test("filters by artist; filters.artists names every visible artist with a shown design, by name, whatever the filter", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("api-flash-129e");
		const sita = await addArtist(tenant, owner);
		const arjun = await addArtist(tenant, owner, {
			name: "Arjun",
			slug: "arjun",
		});
		await addArtist(tenant, owner, { name: "Empty", slug: "empty" });
		const [s, a] = await inTenant(tenant, async () => [
			await addFlashDesign(tenant, sita, { createdAt: at(1) }),
			await addFlashDesign(tenant, arjun, { createdAt: at(2) }),
		]);
		const names = [
			{ slug: "arjun", name: "Arjun" },
			{ slug: "sita", name: "Sita Rai" },
		];

		const bySita = (
			await client.get(flash("api-flash-129e", "?artist=sita"))
		).body();
		const byArjun = (
			await client.get(flash("api-flash-129e", "?artist=arjun"))
		).body();
		const none = (
			await client.get(flash("api-flash-129e", "?artist=empty"))
		).body();
		const unknown = (
			await client.get(flash("api-flash-129e", "?artist=nobody"))
		).body();

		assert.deepEqual(ids(bySita.data), [s.id]);
		assert.deepEqual(ids(byArjun.data), [a.id]);
		for (const body of [bySita, byArjun, none, unknown]) {
			assert.deepEqual(body.filters.artists, names);
		}
		assert.deepEqual(none.data, []);
		assert.deepEqual(unknown.data, []);
	});

	test("a malformed cursor, artist or limit is validation_failed with that field", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("api-flash-129f");
		const sita = await addArtist(tenant, owner);
		await inTenant(tenant, () => addFlashDesign(tenant, sita));
		const cases: [query: string, field: string][] = [
			["cursor=!!", "cursor"],
			[`cursor=${Buffer.from("x~y").toString("base64url")}`, "cursor"],
			[
				`cursor=${encodeWorkCursor({ at: "2026-13-01T10:00:00.000000Z", id: "00000000-0000-4000-8000-000000000000" })}`,
				"cursor",
			],
			["cursor=", "cursor"],
			["artist=Sita", "artist"],
			["artist=s", "artist"],
			["limit=0", "limit"],
			["limit=49", "limit"],
			["limit=1.5", "limit"],
			["limit=many", "limit"],
			["artist=sita&artist=bina", "artist"],
		];

		for (const [query, field] of cases) {
			const response = await client.get(flash("api-flash-129f", `?${query}`));
			assertApiError(response, 422, "validation_failed");
			assert.deepEqual(
				Object.keys(response.body().error.fields),
				[field],
				query,
			);
		}
		const response = await client.get(
			flash(
				"api-flash-129f",
				`?cursor=${Buffer.from("x~y").toString("base64url")}`,
			),
		);
		assert.deepEqual(response.body().error.fields, {
			cursor: [CURSOR_MESSAGE],
		});
	});

	test("the design read gives one design with the same fields; another studio's id, an unknown id and a hidden one are 404; a malformed id is the router's 404", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("api-flash-129g");
		const other = await studioWithOwner("api-flash-129h");
		const sita = await addArtist(tenant, owner);
		const artistB = await addArtist(other.tenant, other.owner);
		const mine = await inTenant(tenant, () =>
			addFlashDesign(tenant, sita, { price: 150_000 }),
		);
		const theirs = await inTenant(other.tenant, () =>
			addFlashDesign(other.tenant, artistB),
		);

		const one = await client.get(design("api-flash-129g", mine.id));
		one.assertStatus(200);
		assertApiHeaders(one);
		const listed = (await client.get(flash("api-flash-129g"))).body().data[0];
		assert.deepEqual(one.body(), { data: listed });
		assert.deepEqual(Object.keys(one.body().data).sort(), DESIGN_FIELDS);
		assert.equal(one.body().data.price.text, "NPR 1,500");

		for (const id of [
			theirs.id,
			"0199f000-0000-7000-8000-000000000001",
			"NOT-A-UUID",
		]) {
			assertApiError(
				await client.get(design("api-flash-129g", id)),
				404,
				"not_found",
			);
		}
	});

	test("both reads are cacheable: public, an ETag and a 304; under an old studio slug they answer like under the current one", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("api-flash-129i");
		const sita = await addArtist(tenant, owner);
		const mine = await inTenant(tenant, () => addFlashDesign(tenant, sita));
		const urls = [
			flash("api-flash-129i", "?limit=5"),
			design("api-flash-129i", mine.id),
		];

		for (const url of urls) {
			const first = await client.get(url);
			first.assertHeader("cache-control", CACHED);
			const etag = first.header("etag") ?? "";
			assert.isNotEmpty(etag);
			const again = await client.get(url).header("if-none-match", etag);
			again.assertStatus(304);
			assertNoCookies(again);
			const head = await client.head(url);
			head.assertStatus(200);
			head.assertHeader("etag", etag);
		}
		const refused = await client.get(flash("api-flash-129i", "?limit=0"));
		refused.assertHeader("cache-control", "no-store");

		await inTenant(tenant, () => tenancy.changeSlug(tenant, "api-flash-129j"));
		const old = await client.get(flash("api-flash-129i"));
		const current = await client.get(flash("api-flash-129j"));
		old.assertStatus(200);
		assert.lengthOf(current.body().data, 1);
		assert.deepEqual(old.body(), current.body());
		assert.deepEqual(
			(await client.get(design("api-flash-129i", mine.id))).body(),
			(await client.get(design("api-flash-129j", mine.id))).body(),
		);
	});

	test("an unknown studio is a 404 and a POST a 405", async ({ client }) => {
		await studioWithOwner("api-flash-129k");

		assertApiError(
			await client.get(flash("no-such-studio-td129")),
			404,
			"not_found",
		);
		const post = await client.post(flash("api-flash-129k")).json({});
		assertApiError(post, 405, "method_not_allowed");
		post.assertHeader("allow", "GET, HEAD");
	});
});
