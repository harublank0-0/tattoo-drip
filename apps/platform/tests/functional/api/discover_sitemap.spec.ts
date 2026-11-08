import testUtils from "@adonisjs/core/services/test_utils";
import type { ApiResponse } from "@japa/api-client";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import type Artist from "#modules/artists/models/artist";
import type Tenant from "#modules/tenancy/models/tenant";
import TenancyService from "#modules/tenancy/services/tenancy_service";
import { dbClient } from "#services/db_context";
import { assertApiError } from "#tests/helpers/api";
import { fillApiLimit } from "#tests/helpers/api_limits";
import { addArtist, addWorkPhoto } from "#tests/helpers/artists";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

/**
 * Discover D10 against PostgreSQL: the sitemap lists
 * (`/discover/sitemap/{studios,artists,tattoos}`): canonical identifiers
 * only, from the D02 views (the lists' own eligibility), keyset-paged by
 * id. Fixtures are written in each studio's context, as in
 * discover_gallery.spec.ts.
 */

const T0 = DateTime.fromISO("2026-10-01T10:00:00.000Z", { zone: "utc" });

async function list(tenant: Tenant) {
	await inTenant(tenant, () =>
		dbClient().rawQuery(
			`update tenants set discovery_listed = true, discovery_listed_at = ?,
			 place_id = (select id from places where country_code = 'NP' and slug = 'kathmandu')
			 where id = ?`,
			[T0.toJSDate(), tenant.id],
		),
	);
}

async function set(tenant: Tenant, table: string, sql: string, id: string) {
	await inTenant(tenant, () =>
		dbClient().rawQuery(`update ${table} set ${sql} where id = ?`, [id]),
	);
}

/**
 * Two listed studios, a listed independent with two artist profiles, a
 * never-listed studio, and the rows each kind of rule removes.
 */
async function world() {
	const needle = await studioWithOwner("map-black-needle", "Black Needle");
	await list(needle.tenant);
	const sita = await addArtist(needle.tenant, needle.owner, {
		name: "Sita Rai",
		slug: "sita",
	});
	const bina = await addArtist(needle.tenant, needle.owner, {
		name: "Bina Tamang",
		slug: "bina",
	});
	const hiddenArtist = await addArtist(needle.tenant, needle.owner, {
		name: "Hidden Hari",
		slug: "hari",
	});
	const photo = (tenant: Tenant, artist: Artist, minutes: number) =>
		inTenant(tenant, () =>
			addWorkPhoto(tenant, artist, { createdAt: T0.plus({ minutes }) }),
		);
	const koi = await photo(needle.tenant, sita, 1);
	const swallow = await photo(needle.tenant, bina, 2);
	const unpublished = await photo(needle.tenant, sita, 3);
	const takenDown = await photo(needle.tenant, bina, 4);
	const ofHidden = await photo(needle.tenant, hiddenArtist, 5);
	await set(
		needle.tenant,
		"artist_work_photos",
		"hidden = true",
		unpublished.id,
	);
	await set(
		needle.tenant,
		"artist_work_photos",
		"discovery_suspended_at = now()",
		takenDown.id,
	);
	await set(
		needle.tenant,
		"artists",
		"discovery_listed = false",
		hiddenArtist.id,
	);

	const lotus = await studioWithOwner("map-lotus-ink", "Lotus Ink");
	await list(lotus.tenant);
	const ram = await addArtist(lotus.tenant, lotus.owner, {
		name: "Ram Thapa",
		slug: "ram",
	});
	const dragon = await photo(lotus.tenant, ram, 6);

	const { owner } = await studioWithOwner("map-solo-owner", "Solo Owner");
	const solo = await new TenancyService().createTenant(owner, {
		type: "independent",
		name: "Asha Solo",
		slug: "map-asha-solo",
		timezone: "Asia/Kathmandu",
	});
	await list(solo);
	const asha = await addArtist(solo, owner, { name: "Asha", slug: "asha" });
	await addArtist(solo, owner, { name: "Asha Again", slug: "asha-two" });
	const mandala = await photo(solo, asha, 7);

	const unlisted = await studioWithOwner("map-unlisted", "Unlisted Ink");
	const ghost = await addArtist(unlisted.tenant, unlisted.owner, {
		name: "Ghost",
		slug: "ghost",
	});
	const ghostPhoto = await photo(unlisted.tenant, ghost, 8);

	const suspended = await studioWithOwner("map-suspended", "Suspended Ink");
	await list(suspended.tenant);
	const gone = await addArtist(suspended.tenant, suspended.owner, {
		name: "Gone",
		slug: "gone",
	});
	const gonePhoto = await photo(suspended.tenant, gone, 9);
	await set(
		suspended.tenant,
		"tenants",
		"discovery_suspended_at = now()",
		suspended.tenant.id,
	);

	return {
		needle,
		lotus,
		solo,
		photos: {
			shown: [koi, swallow, dragon, mandala].map(({ id }) => id),
			absent: [unpublished, takenDown, ofHidden, ghostPhoto, gonePhoto].map(
				({ id }) => id,
			),
		},
	};
}

const get = (client: { get: (path: string) => unknown }, path: string) =>
	client.get(`/api/v1/discover/sitemap/${path}`) as Promise<ApiResponse>;
const sorted = (values: string[]) => [...values].sort();

test.group("Discover API D10: sitemap lists", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("studios: only listed studios' current slugs, by id; never an independent", async ({
		client,
		assert,
	}) => {
		const { needle, lotus } = await world();
		const response = await get(client, "studios");
		response.assertStatus(200);
		assert.deepEqual(Object.keys(response.body()), ["data", "nextCursor"]);
		const byId = sorted([needle.tenant.id, lotus.tenant.id]);
		assert.deepEqual(
			response.body().data,
			byId.map((id) => ({
				slug: id === needle.tenant.id ? "map-black-needle" : "map-lotus-ink",
			})),
		);
		assert.isNull(response.body().nextCursor);
		assert.match(response.header("cache-control") ?? "", /public, max-age=60/);
	});

	test("artists: shown studio artists and one profile per independent, as the detail reads answer", async ({
		client,
		assert,
	}) => {
		await world();
		const rows: { slug: string; studio: { slug: string; type: string } }[] = (
			await get(client, "artists")
		).body().data;
		// An independent's one entry is the artist its profile shows (the
		// first made: the profile created with the business), never a second.
		const profile = (
			await client.get("/api/v1/discover/artists/map-asha-solo")
		).body().data;
		assert.sameDeepMembers(rows, [
			{ slug: "sita", studio: { slug: "map-black-needle", type: "studio" } },
			{ slug: "bina", studio: { slug: "map-black-needle", type: "studio" } },
			{ slug: "ram", studio: { slug: "map-lotus-ink", type: "studio" } },
			{
				slug: profile.slug,
				studio: { slug: "map-asha-solo", type: "independent" },
			},
		]);
		for (const row of rows.filter((each) => each.studio.type === "studio")) {
			(
				await client.get(
					`/api/v1/discover/studios/${row.studio.slug}/artists/${row.slug}`,
				)
			).assertStatus(200);
		}
	});

	test("tattoos: every published photo's id, never one unpublished, taken down or of a hidden artist or studio", async ({
		client,
		assert,
	}) => {
		const { photos } = await world();
		const ids = (await get(client, "tattoos"))
			.body()
			.data.map((row: { id: string }) => row.id);
		assert.deepEqual(ids, sorted(photos.shown));
		for (const id of photos.absent) assert.notInclude(ids, id);
		for (const id of ids)
			(await client.get(`/api/v1/discover/tattoos/${id}`)).assertStatus(200);
	});

	test("keyset paging by id: every row once, a stable order, rows after the cursor only", async ({
		client,
		assert,
	}) => {
		const { photos } = await world();
		const seen: string[] = [];
		let cursor: string | null = null;
		let pages = 0;
		do {
			const response: ApiResponse = await get(
				client,
				`tattoos?limit=3${cursor ? `&cursor=${cursor.toUpperCase()}` : ""}`,
			);
			response.assertStatus(200);
			const page = response.body();
			assert.isAtMost(page.data.length, 3);
			seen.push(...page.data.map((row: { id: string }) => row.id));
			cursor = page.nextCursor;
			if (cursor) assert.equal(cursor, seen[seen.length - 1]);
			pages++;
		} while (cursor && pages < 10);
		assert.equal(pages, 2);
		assert.deepEqual(seen, sorted(photos.shown));
		// A cursor past the last row: an empty last page.
		const last = sorted(photos.shown).at(-1) as string;
		assert.deepEqual((await get(client, `tattoos?cursor=${last}`)).body(), {
			data: [],
			nextCursor: null,
		});
	});

	test("a malformed cursor or limit is a 422; the kind must be one of the three", async ({
		client,
	}) => {
		for (const qs of [
			"cursor=nope",
			"cursor=W10",
			"limit=0",
			"limit=5001",
			"limit=1.5",
		])
			assertApiError(
				await get(client, `tattoos?${qs}`),
				422,
				"validation_failed",
			);
		(await get(client, "styles")).assertStatus(404);
	});

	test("each page counts against discoverSitemap", async ({ client }) => {
		await fillApiLimit("discoverSitemap", {
			kind: "anonymous",
			ip: "203.0.113.91",
		});
		assertApiError(
			await client
				.get("/api/v1/discover/sitemap/studios")
				.header("x-forwarded-for", "203.0.113.91"),
			429,
			"rate_limited",
		);
	});

	test("answers carry no private field", async ({ client, assert }) => {
		await world();
		for (const kind of ["studios", "artists", "tattoos"]) {
			const text = JSON.stringify((await get(client, kind)).body());
			for (const word of [
				"email",
				"phone",
				"listed_at",
				"created_at",
				"tenant_id",
				"Unlisted",
				"Suspended",
				"hari",
			])
				assert.notInclude(text, word, kind);
		}
	});
});
