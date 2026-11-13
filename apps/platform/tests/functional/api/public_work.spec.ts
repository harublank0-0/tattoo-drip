import app from "@adonisjs/core/services/app";
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import type ArtistWorkPhoto from "#modules/artists/models/artist_work_photo";
import ArtistService from "#modules/artists/services/artist_service";
import WorkPhotoService from "#modules/artists/services/work_photo_service";
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
import { addArtist, addWorkPhoto, addWorkVideo } from "#tests/helpers/artists";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

const CACHED = "public, max-age=60, stale-while-revalidate=600";
const images = new ImageService();
const tenancy = new TenancyService();

/** The documented fields (openapi.yaml, GalleryPhoto, WorkFilters). A new one needs the contract and a ruling first; `id` had both (getWorkPhoto), `angles` too (a tattoo's other photos). */
const BODY_FIELDS = ["data", "filters", "nextCursor"];
const PHOTO_FIELDS = [
	"alt",
	"angles",
	"artist",
	"healed",
	"height",
	"id",
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

/** A PhotoAngle's fields: each photo angle carries exactly these, no id, key or date. */
const ANGLE_FIELDS = ["alt", "height", "kind", "url", "variants", "width"];
/** A VideoAngle's fields (video angles): never a staging key, a state, a failure or an id. */
const VIDEO_FIELDS = ["alt", "durationMs", "kind", "poster", "sources"];

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
		// The photo's id (getWorkPhoto takes it); the cursor already carried it.
		assert.deepEqual(
			body.data.map((photo: { id: string }) => photo.id),
			[second, third, first].map((row) => row.id),
		);
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
		// Never the rest of the row: no key column, artist id, tenant id or timestamp.
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
		for (const artist of [sita, bina]) assert.notInclude(text, artist.id);
	});

	test("lists a tattoo once, as its lead with its angles in order, each with exactly PhotoAngle's fields; the lead's styles and healed mark filter it", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("api-work-angles-a");
		const sita = await addArtist(tenant, owner);
		const { lead, second, third, single } = await inTenant(tenant, async () => {
			const lead = await addWorkPhoto(tenant, sita, {
				createdAt: at(1),
				styles: ["realism"],
				healed: true,
			});
			// Angles are dated later than their lead: they never list on their own.
			const third = await addWorkPhoto(tenant, sita, {
				createdAt: at(5),
				alt: "From the side",
				styles: ["realism"],
				healed: true,
				angleOf: { lead, position: 2 },
			});
			const second = await addWorkPhoto(tenant, sita, {
				createdAt: at(6),
				width: 300,
				styles: ["realism"],
				healed: true,
				angleOf: { lead, position: 1 },
			});
			const single = await addWorkPhoto(tenant, sita, { createdAt: at(3) });
			return { lead, second, third, single };
		});

		const body = (await client.get(work("api-work-angles-a"))).body();

		assert.deepEqual(
			body.data.map((photo: { id: string }) => photo.id),
			[single.id, lead.id],
		);
		const [one, tattoo] = body.data;
		assert.deepEqual(one.angles, []);
		assert.deepEqual(keysOf(tattoo.angles), rowKeys([second, third]));
		for (const angle of tattoo.angles) {
			assert.deepEqual(Object.keys(angle).sort(), ANGLE_FIELDS);
			assert.equal(angle.kind, "photo");
		}
		assert.equal(tattoo.angles[0].width, 300);
		for (const variant of tattoo.angles[0].variants) {
			assert.deepEqual(Object.keys(variant).sort(), ["url", "width"]);
		}
		assert.isNull(tattoo.angles[0].alt);
		assert.equal(tattoo.angles[1].alt, "From the side");
		assert.notInclude(JSON.stringify(body), second.id);
		assert.notInclude(JSON.stringify(body), third.id);
		// The filters are the leads' (the tattoo's), and so is what they match.
		assert.deepEqual(body.filters, {
			styles: [{ slug: "realism", name: "Realism" }],
			healed: true,
		});
		const healed = (await client.get(work("api-work-angles-a", "?healed=true")))
			.body()
			.data.map((photo: { id: string }) => photo.id);
		assert.deepEqual(healed, [lead.id]);
	});

	test("video angles: a ready video is listed in its place with exactly VideoAngle's fields; a processing or failed one never leaves the dashboard", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("api-work-video-a");
		const sita = await addArtist(tenant, owner);
		const { lead, photo, ready } = await inTenant(tenant, async () => {
			const lead = await addWorkPhoto(tenant, sita, { createdAt: at(1) });
			const photo = await addWorkPhoto(tenant, sita, {
				createdAt: at(2),
				angleOf: { lead, position: 1 },
			});
			const ready = await addWorkVideo(tenant, sita, lead, 2, {
				alt: "Healed, in the sun",
			});
			await addWorkVideo(tenant, sita, lead, 3, { state: "processing" });
			await addWorkVideo(tenant, sita, lead, 4, { state: "failed" });
			return { lead, photo, ready };
		});

		for (const url of [
			work("api-work-video-a"),
			`${work("api-work-video-a")}/${lead.id}`,
		]) {
			const body = (await client.get(url)).body();
			const tattoo = Array.isArray(body.data) ? body.data[0] : body.data;
			assert.equal(tattoo.id, lead.id);
			assert.deepEqual(
				tattoo.angles.map((angle: { kind: string }) => angle.kind),
				["photo", "video"],
			);
			const video = tattoo.angles[1];
			assert.deepEqual(Object.keys(video).sort(), VIDEO_FIELDS);
			assert.equal(video.alt, "Healed, in the sun");
			assert.equal(video.durationMs, 42_000);
			assert.deepEqual(Object.keys(video.poster).sort(), [
				"alt",
				"height",
				"url",
				"variants",
				"width",
			]);
			assert.equal(video.poster.width, 1080);
			assert.equal(video.poster.height, 1920);
			assert.equal(
				new URL(video.poster.url).pathname.replace(/^\/uploads\//, ""),
				ready.imageKey,
			);
			assert.deepEqual(
				video.poster.variants.map((copy: { width: number }) => copy.width),
				[320, 640],
			);
			// Smallest first, so a phone takes the 720p one.
			assert.deepEqual(video.sources, [
				{
					url: `${new URL(video.poster.url).origin}/uploads/${ready.videoKeys?.[0]}`,
					type: "video/mp4",
					width: 720,
					height: 1280,
				},
				{
					url: `${new URL(video.poster.url).origin}/uploads/${ready.videoKeys?.[1]}`,
					type: "video/mp4",
					width: 1080,
					height: 1920,
				},
			]);
			const text = JSON.stringify(body);
			assert.notInclude(text, ready.id);
			assert.notInclude(text, photo.id);
			assert.notInclude(text, "work_video_upload");
			assert.notInclude(text, "processing");
			assert.notInclude(text, "60 seconds");
		}
	});

	test("the lead decides for its tattoo: a hidden lead hides its angles, and an angle's own stale columns change nothing", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("api-work-angles-b");
		const sita = await addArtist(tenant, owner);
		const { shownLead, hiddenLead } = await inTenant(tenant, async () => {
			const shownLead = await addWorkPhoto(tenant, sita, { createdAt: at(2) });
			// Columns that disagree with the lead (the service never leaves them
			// so): the public read still asks the lead's only.
			await addWorkPhoto(tenant, sita, {
				hidden: true,
				styles: ["blackwork"],
				healed: true,
				angleOf: { lead: shownLead, position: 1 },
			});
			const hiddenLead = await addWorkPhoto(tenant, sita, {
				createdAt: at(1),
				hidden: true,
			});
			await addWorkPhoto(tenant, sita, {
				angleOf: { lead: hiddenLead, position: 1 },
			});
			return { shownLead, hiddenLead };
		});

		const body = (await client.get(work("api-work-angles-b"))).body();

		assert.deepEqual(
			body.data.map((photo: { id: string }) => photo.id),
			[shownLead.id],
		);
		assert.lengthOf(body.data[0].angles, 1);
		assert.deepEqual(body.filters, { styles: [], healed: false });
		assert.notInclude(JSON.stringify(body), hiddenLead.id);
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

	test("a style asked for stays in the filters when the chosen artist has no photo of it, so the page's controls show the filtering", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("api-work-126q");
		const a = await addArtist(tenant, owner, { name: "Asha", slug: "asha" });
		await addArtist(tenant, owner, { name: "Bina", slug: "bina" });
		await inTenant(tenant, () =>
			addWorkPhoto(tenant, a, { createdAt: at(1), styles: ["blackwork"] }),
		);
		const blackwork = { slug: "blackwork", name: "Blackwork" };
		const fineLine = { slug: "fine-line", name: "Fine line" };

		const lacking = await client.get(
			work("api-work-126q", "?artist=asha&style=fine-line"),
		);
		const carried = await client.get(
			work("api-work-126q", "?artist=asha&style=blackwork"),
		);
		const retired = await client.get(
			work("api-work-126q", "?artist=asha&style=retired-style"),
		);

		lacking.assertStatus(200);
		assert.deepEqual(lacking.body(), {
			data: [],
			nextCursor: null,
			filters: { styles: [blackwork, fineLine], healed: false },
		});
		// One the artist carries is there once; one that is not on the list is never added.
		assert.deepEqual(carried.body().filters.styles, [blackwork]);
		assert.deepEqual(retired.body().filters.styles, [blackwork]);
		assert.deepEqual(Object.keys(lacking.body().filters).sort(), [
			"healed",
			"styles",
		]);
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

test.group(
	"GET /api/v1/tenants/:tenant/work/:photo (getWorkPhoto)",
	(group) => {
		group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

		const photoUrl = (slug: string, id: string) =>
			`/api/v1/tenants/${slug}/work/${id}`;

		test("is the photo as listWork shows it, with exactly the documented fields", async ({
			client,
			assert,
		}) => {
			const { owner, tenant } = await studioWithOwner("api-work-photo-a");
			const sita = await addArtist(tenant, owner);
			const photo = await inTenant(tenant, () =>
				addWorkPhoto(tenant, sita, {
					alt: "Koi on the forearm",
					styles: ["realism", "blackwork"],
					healed: true,
				}),
			);

			const response = await client.get(photoUrl("api-work-photo-a", photo.id));
			const listed = (await client.get(work("api-work-photo-a"))).body()
				.data[0];

			response.assertStatus(200);
			assertApiHeaders(response);
			response.assertHeader("cache-control", CACHED);
			const body = response.body();
			assert.deepEqual(Object.keys(body), ["data"]);
			assert.deepEqual(Object.keys(body.data).sort(), PHOTO_FIELDS);
			assert.deepEqual(body.data, listed);
			assert.equal(body.data.id, photo.id);
			assert.deepEqual(body.data.artist, { slug: "sita", name: "Sita Rai" });
			const text = JSON.stringify(body);
			for (const word of [
				"created",
				"artist_id",
				"artistId",
				"image_key",
				"imageKey",
				"tenantId",
				"tenant_id",
			]) {
				assert.notInclude(text, word);
			}
			assert.notInclude(text, sita.id);
		});

		test("an angle's id answers with its tattoo, whose id is the lead's; a hidden tattoo's angle is the 404", async ({
			client,
			assert,
		}) => {
			const { owner, tenant } = await studioWithOwner("api-work-photo-ang");
			const sita = await addArtist(tenant, owner);
			const { lead, angle, hiddenAngle } = await inTenant(tenant, async () => {
				const lead = await addWorkPhoto(tenant, sita, { alt: "Koi" });
				const angle = await addWorkPhoto(tenant, sita, {
					alt: "Koi, the back",
					angleOf: { lead, position: 1 },
				});
				const hidden = await addWorkPhoto(tenant, sita, { hidden: true });
				const hiddenAngle = await addWorkPhoto(tenant, sita, {
					hidden: true,
					angleOf: { lead: hidden, position: 1 },
				});
				return { lead, angle, hiddenAngle };
			});

			const byLead = await client.get(photoUrl("api-work-photo-ang", lead.id));
			const byAngle = await client.get(
				photoUrl("api-work-photo-ang", angle.id),
			);

			byLead.assertStatus(200);
			byAngle.assertStatus(200);
			assert.deepEqual(byAngle.body(), byLead.body());
			assert.equal(byAngle.body().data.id, lead.id);
			assert.deepEqual(
				byAngle.body().data.angles.map((photo: { alt: string }) => photo.alt),
				["Koi, the back"],
			);
			assertApiError(
				await client.get(photoUrl("api-work-photo-ang", hiddenAngle.id)),
				404,
				"not_found",
			);
		});

		test("a closed artist's photo is shown; a hidden or deleted artist's, a removed and an unknown photo are the 404", async ({
			client,
		}) => {
			const { owner, tenant } = await studioWithOwner("api-work-photo-b");
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
			const gone = await addArtist(tenant, owner, {
				name: "Gone",
				slug: "gone",
			});
			const [shown, ofHidden, ofGone, removed] = await inTenant(
				tenant,
				async () => [
					await addWorkPhoto(tenant, closed),
					await addWorkPhoto(tenant, hidden),
					await addWorkPhoto(tenant, gone),
					await addWorkPhoto(tenant, closed),
				],
			);
			await inTenant(tenant, async () => {
				await new ArtistService(images).delete(tenant, gone);
				await removed.delete();
			});

			(await client.get(photoUrl("api-work-photo-b", shown.id))).assertStatus(
				200,
			);
			for (const id of [
				ofHidden.id,
				ofGone.id,
				removed.id,
				"0192f0a0-0000-7000-8000-000000000000",
			]) {
				assertApiError(
					await client.get(photoUrl("api-work-photo-b", id)),
					404,
					"not_found",
				);
			}
		});

		test("findShown asks again in its own query that the artist is visible: a stale id list shows nothing of an artist hidden since", async ({
			assert,
		}) => {
			const { owner, tenant } = await studioWithOwner("api-work-photo-h");
			const hidden = await addArtist(tenant, owner, {
				name: "Hidden",
				slug: "hidden",
				visible: false,
			});
			const photo = await inTenant(tenant, () => addWorkPhoto(tenant, hidden));
			const service = await app.container.make(WorkPhotoService);

			// As if the caller read the visible artists before Hidden was hidden.
			const found = await inTenant(tenant, () =>
				service.findShown(tenant, photo.id, [hidden.id]),
			);

			assert.isNull(found);
		});

		test("another studio's photo is the 404, under its own slug it is shown", async ({
			client,
		}) => {
			const mine = await studioWithOwner("api-work-photo-c");
			const theirs = await studioWithOwner("api-work-photo-d");
			await addArtist(mine.tenant, mine.owner);
			const theirSita = await addArtist(theirs.tenant, theirs.owner);
			const photo = await inTenant(theirs.tenant, () =>
				addWorkPhoto(theirs.tenant, theirSita),
			);

			assertApiError(
				await client.get(photoUrl("api-work-photo-c", photo.id)),
				404,
				"not_found",
			);
			(await client.get(photoUrl("api-work-photo-d", photo.id))).assertStatus(
				200,
			);
		});

		test("an id that is not a UUID is the router's 404, and a POST a 405", async ({
			client,
		}) => {
			await studioWithOwner("api-work-photo-e");

			assertApiError(
				await client.get(photoUrl("api-work-photo-e", "not-a-uuid")),
				404,
				"not_found",
			);
			const post = await client
				.post(
					photoUrl("api-work-photo-e", "0192f0a0-0000-7000-8000-000000000000"),
				)
				.json({});
			assertApiError(post, 405, "method_not_allowed");
		});

		test("is cacheable: an ETag and a 304, and under an old studio slug it answers like under the current one", async ({
			client,
			assert,
		}) => {
			const { owner, tenant } = await studioWithOwner("api-work-photo-f");
			const sita = await addArtist(tenant, owner);
			const photo = await inTenant(tenant, () => addWorkPhoto(tenant, sita));
			await changeSlug(tenant, "api-work-photo-g");

			const current = await client.get(photoUrl("api-work-photo-g", photo.id));
			const etag = current.header("etag") ?? "";
			assert.isNotEmpty(etag);
			const again = await client
				.get(photoUrl("api-work-photo-g", photo.id))
				.header("if-none-match", etag);
			again.assertStatus(304);
			assertNoCookies(again);
			const old = await client.get(photoUrl("api-work-photo-f", photo.id));
			assert.deepEqual(old.body(), current.body());
		});
	},
);
