import { randomBytes } from "node:crypto";
import { stat } from "node:fs/promises";
import app from "@adonisjs/core/services/app";
import db from "@adonisjs/lucid/services/db";
import type { QueryClientContract } from "@adonisjs/lucid/types/database";
import type { Assert } from "@japa/assert";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import sharp from "sharp";
import DemoStudioSiteSeeder from "#database/seeders/demo_studio_site_seeder";
import Artist from "#modules/artists/models/artist";
import ArtistWorkPhoto from "#modules/artists/models/artist_work_photo";
import { MAX_PHOTO_STYLES, STYLE_SLUGS } from "#modules/artists/styles";
import { createArtistValidator } from "#modules/artists/validators/artist";
import { updateWorkPhotoValidator } from "#modules/artists/validators/work_photo";
import FlashDesign from "#modules/flash/models/flash_design";
import { updateFlashDesignValidator } from "#modules/flash/validators/flash_design";
import { variantsOfKey } from "#modules/media/variants";
import { todayIn } from "#modules/projects/quotes";
import StudioClosure from "#modules/scheduling/models/studio_closure";
import StudioHour from "#modules/scheduling/models/studio_hour";
import Tenant from "#modules/tenancy/models/tenant";
import { updateGoodToKnowValidator } from "#modules/tenancy/validators/good_to_know";
import {
	addArtist,
	addFlashDesign,
	addWorkPhoto,
} from "#tests/helpers/artists";
import { forgetStudio } from "#tests/helpers/races";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";
import { storedImages } from "#tests/helpers/uploads";

/**
 * The development seeder gives studios a website worth looking at (artists,
 * work photos, flash, hours, closed days, Good to know). It runs as the owner
 * role, which row-level security does not apply to, so the tenant scoping of
 * its queries is its own: these tests commit studios (outside the global
 * transaction), run it on the owner connection narrowed to their own studios
 * and remove them again. They never seed a studio they did not create.
 */

const SLOW = 120_000;
const FIRST_SIX = [
	"Moth",
	"Dagger and rose",
	"Lotus",
	"Mountain sun",
	"Snake",
	"Swallow",
];
const slugs: string[] = [];

/** Seeds only the studios it is given; everything else is the seeder's own run(). */
class Narrowed extends DemoStudioSiteSeeder {
	constructor(
		client: QueryClientContract,
		private ids: string[],
	) {
		super(client);
	}

	protected override async studios() {
		return Tenant.query({ client: this.client }).whereIn("id", this.ids);
	}
}

const seed = (...tenants: Tenant[]) =>
	new Narrowed(
		db.connection("owner"),
		tenants.map((tenant) => tenant.id),
	).run();

async function studio(label: string) {
	const slug = `demo-site-${label}-${randomBytes(3).toString("hex")}`;
	slugs.push(slug);
	return studioWithOwner(slug, `Demo ${label}`);
}

const asOwner = (sql: string, bindings: string[]) =>
	db.connection("owner").rawQuery(sql, bindings);

/** Every row the seeder can write for a studio, as plain data, for equality checks. */
function dump(tenant: Tenant) {
	const own = { tenant_id: tenant.id };
	return inTenant(tenant, async () => ({
		tenant: (await Tenant.findOrFail(tenant.id)).serialize(),
		artists: (await Artist.query().where(own).orderBy("slug")).map(plain),
		photos: (await ArtistWorkPhoto.query().where(own).orderBy("id")).map(plain),
		flash: (await FlashDesign.query().where(own).orderBy("id")).map(plain),
		hours: (await StudioHour.query().where(own).orderBy("weekday")).map(plain),
		closures: (await StudioClosure.query().where(own).orderBy("id")).map(plain),
	}));
}

const plain = (row: { serialize(): unknown }) => row.serialize();

const hoursOf = (tenant: Tenant) =>
	inTenant(tenant, () =>
		StudioHour.query().where("tenant_id", tenant.id).orderBy("weekday"),
	);

const closuresOf = (tenant: Tenant) =>
	inTenant(tenant, () =>
		StudioClosure.query().where("tenant_id", tenant.id).orderBy("starts_on"),
	);

const tenantRow = (tenant: Tenant) =>
	inTenant(tenant, () => Tenant.findOrFail(tenant.id));

/** The studio's visible artists with their photos and designs, by slug. */
function shown(tenant: Tenant) {
	return inTenant(tenant, async () => {
		const artists = await Artist.query()
			.where("tenant_id", tenant.id)
			.where("visible", true)
			.orderBy("slug");
		const out = [];
		for (const artist of artists) {
			out.push({
				artist,
				photos: await ArtistWorkPhoto.query()
					.where("tenant_id", tenant.id)
					.where("artist_id", artist.id)
					.orderBy("created_at", "desc")
					.orderBy("id", "desc"),
				flash: await FlashDesign.query()
					.where("tenant_id", tenant.id)
					.where("artist_id", artist.id)
					.orderBy("created_at", "desc")
					.orderBy("id", "desc"),
			});
		}
		return out;
	});
}

/** A stored picture's own file (its key names its copies), not one of the copies. */
const ORIGINAL = /^[0-9a-f-]{36}\.[\d-]+\.jpg$/;

const fileOf = (key: string) => app.tmpPath("storage", "public", key);

/** A stored picture and its copies are on the disk, and it is dark line art on a light ground. */
async function assertLineArt(
	assert: Assert,
	key: string,
	size: { width: number; height: number },
) {
	await stat(fileOf(key));
	const copies = variantsOfKey(key);
	assert.isAbove(copies.length, 0, `${key} names no copies`);
	for (const copy of copies) await stat(fileOf(copy.key));
	// 320, 640 and 1280 px, each only when the picture is wider (never enlarged).
	const wanted = [320, 640, 1280].filter((width) => width < size.width);
	assert.deepEqual(
		copies.map((copy) => copy.width),
		wanted,
	);
	const image = sharp(fileOf(key));
	const meta = await image.metadata();
	assert.equal(meta.width, size.width);
	assert.equal(meta.height, size.height);
	const { channels } = await image.stats();
	assert.isBelow(Math.min(...channels.map((c) => c.min)), 60, "no black ink");
	assert.isAbove(channels[0].mean, 120, "the ground is not light");
	assert.isAbove(channels[0].stdev, 15, "the picture is blank");
}

test.group("DemoStudioSiteSeeder", (group) => {
	group.each.teardown(async () => {
		for (const slug of slugs.splice(0)) await forgetStudio(slug);
	});

	test("gives an empty studio three artists, photos, flash, hours, a closed day and its texts", async ({
		assert,
	}) => {
		const { tenant } = await studio("empty");
		await seed(tenant);

		const artists = await shown(tenant);
		assert.deepEqual(
			artists.map(({ artist }) => artist.name).sort(),
			["Maya Gurung", "Sita Rai", "अर्जुन थापा"].sort(),
		);
		const by = (name: string) => {
			const found = artists.find(({ artist }) => artist.name === name);
			if (!found) throw new Error(`no ${name}`);
			return found;
		};
		assert.isTrue(by("Maya Gurung").artist.acceptingFlash);
		assert.isFalse(by("Maya Gurung").artist.acceptingInquiries);
		assert.isNotEmpty(by("Maya Gurung").artist.closedMessage);
		assert.isTrue(by("Sita Rai").artist.acceptingInquiries);
		assert.isNull(by("Sita Rai").artist.closedMessage);
		assert.isNotNull(by("Sita Rai").artist.instagramUrl);
		assert.isNotNull(by("अर्जुन थापा").artist.instagramUrl);
		assert.isNotNull(by("अर्जुन थापा").artist.facebookUrl);

		const created: DateTime[] = [];
		const shapes = new Set<string>();
		const flashNames: string[][] = [];
		for (const { artist, photos, flash } of artists) {
			// Every rule of the artist form holds for what was written.
			await createArtistValidator.validate({
				name: artist.name,
				slug: artist.slug,
				bio: artist.bio,
				visible: artist.visible,
				acceptingInquiries: artist.acceptingInquiries,
				acceptingFlash: artist.acceptingFlash,
				closedMessage: artist.closedMessage,
				styles: artist.styles,
				instagramUrl: artist.instagramUrl,
				facebookUrl: artist.facebookUrl,
			});
			assert.isNotEmpty(artist.bio);
			assert.isAtLeast(artist.styles.length, 2);
			assert.includeMembers([...STYLE_SLUGS], artist.styles);

			// Photos: eight, newest first, with styles of the artist's own.
			assert.lengthOf(photos, 8);
			assert.isTrue(
				photos.every(
					(photo, index) =>
						index === 0 || photos[index - 1].createdAt >= photo.createdAt,
				),
			);
			assert.equal(new Set(photos.map((p) => p.createdAt.toMillis())).size, 8);
			created.push(...photos.map((photo) => photo.createdAt));
			const healed = photos.filter((photo) => photo.healed).length;
			assert.isAtLeast(healed, 2);
			assert.isAtMost(healed, 4);
			for (const photo of photos) {
				assert.isAtLeast(photo.styles.length, 1);
				assert.isAtMost(photo.styles.length, MAX_PHOTO_STYLES);
				assert.includeMembers(artist.styles, photo.styles);
				await updateWorkPhotoValidator.validate({
					alt: photo.alt,
					styles: photo.styles,
					healed: photo.healed,
				});
				const { width, height, imageKey } = photo;
				if (width === null || height === null || imageKey === null) {
					throw new Error(
						`Seeded photo ${photo.id} is missing its dimensions or image key`,
					);
				}
				shapes.add(
					width === height
						? "square"
						: width > height
							? "landscape"
							: "portrait",
				);
				assert.isAtLeast(Math.max(width, height), 1000);
				await assertLineArt(assert, imageKey, { width, height });
			}

			// Flash: six, a few priced, two of a kind, none hidden.
			assert.lengthOf(flash, 6);
			assert.equal(new Set(flash.map((design) => design.name)).size, 6);
			flashNames.push(flash.map((design) => design.name).sort());
			assert.equal(flash.filter((design) => design.oneOfAKind).length, 2);
			assert.equal(flash.filter((design) => design.price !== null).length, 3);
			for (const design of flash) {
				assert.isFalse(design.hidden);
				assert.isNull(design.claimedAt);
				assert.equal(design.currency, "NPR");
				if (design.price !== null) {
					assert.isAtLeast(design.price, 400_000);
					assert.isAtMost(design.price, 1_200_000);
					assert.equal(design.price % 100, 0);
				}
				await updateFlashDesignValidator.validate({
					name: design.name,
					size: design.size,
					price: design.price === null ? null : design.price / 100,
					oneOfAKind: design.oneOfAKind,
					shown: true,
				});
				await assertLineArt(assert, design.imageKey, design);
			}
		}
		assert.sameMembers([...shapes], ["landscape", "portrait", "square"]);
		assert.isAbove(new Set(created.map((c) => c.toISODate())).size, 10);
		// One artist offers the six the brief names; the others' sets differ.
		assert.isTrue(
			flashNames.some((names) => names.join() === [...FIRST_SIX].sort().join()),
		);
		assert.isAbove(new Set(flashNames.map((names) => names.join())).size, 1);

		// Opening hours: Sunday to Friday 11:00 to 19:00, Saturday closed.
		const hours = await hoursOf(tenant);
		assert.deepEqual(
			hours.map((row) => row.weekday),
			[0, 1, 2, 3, 4, 5],
		);
		for (const row of hours) {
			assert.equal(row.opensAt.slice(0, 5), "11:00");
			assert.equal(row.closesAt.slice(0, 5), "19:00");
		}
		// One closed day: from five days ahead for two days, in the studio's timezone.
		const today = DateTime.fromISO(todayIn(tenant.timezone));
		const closures = await closuresOf(tenant);
		assert.lengthOf(closures, 1);
		assert.equal(
			closures[0].startsOn.toISODate(),
			today.plus({ days: 5 }).toISODate(),
		);
		assert.equal(
			closures[0].endsOn.toISODate(),
			today.plus({ days: 6 }).toISODate(),
		);
		assert.equal(closures[0].note, "Closed for a holiday, back soon");

		// Good to know, the chat number and the deposit policy.
		const row = await tenantRow(tenant);
		await updateGoodToKnowValidator.validate({
			walkIns: row.walkInsText,
			ageRule: row.ageRuleText,
			beforeSession: row.beforeSessionText,
			aftercare: row.aftercareText,
		});
		for (const text of [
			row.walkInsText,
			row.ageRuleText,
			row.beforeSessionText,
			row.aftercareText,
			row.depositPolicy,
		]) {
			assert.isAbove((text ?? "").trim().length, 20);
		}
		assert.isAtMost((row.depositPolicy ?? "").length, 2000);
		assert.equal(row.contactPhone, "+9779800000010");

		// The pictures are the ones the seeder stored: 24 photos and 18 designs.
		assert.lengthOf(
			(await storedImages(tenant, "artist_work_photo")).filter((name) =>
				ORIGINAL.test(name),
			),
			24,
		);
		assert.lengthOf(
			(await storedImages(tenant, "flash_design")).filter((name) =>
				ORIGINAL.test(name),
			),
			18,
		);
	}).timeout(SLOW);

	test("a second run adds nothing and changes nothing", async ({ assert }) => {
		const { tenant } = await studio("again");
		await seed(tenant);
		const before = await dump(tenant);
		const photoFiles = await storedImages(tenant, "artist_work_photo");
		const flashFiles = await storedImages(tenant, "flash_design");

		await seed(tenant);

		assert.deepEqual(await dump(tenant), before);
		assert.deepEqual(
			await storedImages(tenant, "artist_work_photo"),
			photoFiles,
		);
		assert.deepEqual(await storedImages(tenant, "flash_design"), flashFiles);
	}).timeout(SLOW);

	test("keeps what a studio already has and fills only what is empty", async ({
		assert,
	}) => {
		const { tenant, owner } = await studio("keeps");
		// Two visible artists (one closed, one with styles, five photos and a design) and a hidden one.
		const dil = await addArtist(tenant, owner, {
			name: "Dil Maya",
			slug: "dil-maya",
			bio: null,
			acceptingInquiries: false,
			acceptingFlash: false,
			closedMessage: "Back in Poush",
		});
		const pema = await addArtist(tenant, owner, {
			name: "Pema",
			slug: "pema",
			bio: "Pema's own words.",
			styles: ["tribal"],
		});
		const hidden = await addArtist(tenant, owner, {
			name: "Hidden One",
			slug: "hidden-one",
			visible: false,
		});
		const { leads, angle } = await inTenant(tenant, async () => {
			const rows: ArtistWorkPhoto[] = [];
			for (let index = 0; index < 5; index++) {
				rows.push(
					await addWorkPhoto(tenant, pema, {
						createdAt: DateTime.now().minus({ days: 100 + index }),
					}),
				);
			}
			await addFlashDesign(tenant, pema, { name: "Pema's own flash" });
			const angle = await addWorkPhoto(tenant, pema, {
				angleOf: { lead: rows[0], position: 1 },
			});
			return { leads: rows, angle };
		});
		// Opening hours, a closed day, one text and the phone already set.
		await asOwner(
			"insert into studio_hours (tenant_id, weekday, opens_at, closes_at, created_at) values (?, 1, '09:00', '17:00', now())",
			[tenant.id],
		);
		await asOwner(
			"insert into studio_closures (tenant_id, starts_on, ends_on, note, created_at) values (?, current_date + 30, current_date + 31, 'Own holiday', now())",
			[tenant.id],
		);
		await asOwner(
			"update tenants set walk_ins_text = 'Own walk-in words', contact_phone = '+9779811111111', deposit_policy = 'Own deposit words' where id = ?",
			[tenant.id],
		);
		const hiddenBefore = await inTenant(tenant, async () =>
			(await Artist.findOrFail(hidden.id)).serialize(),
		);

		await seed(tenant);

		const artists = await shown(tenant);
		// Two existing visible artists, so one demo artist makes three.
		assert.lengthOf(artists, 3);
		assert.sameMembers(
			artists.map(({ artist }) => artist.name),
			["Dil Maya", "Pema", "Sita Rai"],
		);
		const named = (name: string) => {
			const found = artists.find(({ artist }) => artist.name === name);
			if (!found) throw new Error(`no ${name}`);
			return found;
		};

		// Never renamed; flags and visibility as they were; only empty fields filled.
		const dilNow = named("Dil Maya");
		assert.equal(dilNow.artist.slug, dil.slug);
		assert.isFalse(dilNow.artist.acceptingInquiries);
		assert.isFalse(dilNow.artist.acceptingFlash);
		assert.equal(dilNow.artist.closedMessage, "Back in Poush");
		assert.isTrue(dilNow.artist.visible);
		assert.isAtLeast(dilNow.artist.styles.length, 2);
		assert.isAtMost(dilNow.artist.styles.length, 3);
		assert.includeMembers([...STYLE_SLUGS], dilNow.artist.styles);
		assert.isNotEmpty(dilNow.artist.bio);
		const pemaNow = named("Pema");
		assert.deepEqual(pemaNow.artist.styles, ["tribal"]);
		assert.equal(pemaNow.artist.bio, "Pema's own words.");

		// A visible artist is topped up to eight photos and gets six designs when she has none.
		assert.lengthOf(dilNow.photos, 8);
		assert.lengthOf(dilNow.flash, 6);
		const pemaLeads = pemaNow.photos.filter(
			(photo) => photo.leadPhotoId === null,
		);
		assert.lengthOf(pemaLeads, 8);
		assert.deepEqual(
			pemaNow.photos
				.filter((photo) => photo.leadPhotoId === leads[0].id)
				.map((photo) => photo.id),
			[angle.id],
		);
		assert.includeMembers(
			pemaLeads.map((photo) => photo.id),
			leads.map((photo) => photo.id),
		);
		for (const photo of pemaNow.photos) {
			assert.includeMembers(["tribal"], photo.styles);
		}
		// Pema already had a design: no more are added for her.
		assert.deepEqual(
			pemaNow.flash.map((design) => design.name),
			["Pema's own flash"],
		);

		// A hidden artist is left alone, with no photos or designs.
		const hiddenNow = await inTenant(tenant, async () =>
			(await Artist.findOrFail(hidden.id)).serialize(),
		);
		assert.deepEqual(hiddenNow, hiddenBefore);
		const hiddenRows = await inTenant(tenant, async () => ({
			photos: await ArtistWorkPhoto.query().where("artist_id", hidden.id),
			flash: await FlashDesign.query().where("artist_id", hidden.id),
		}));
		assert.lengthOf(hiddenRows.photos, 0);
		assert.lengthOf(hiddenRows.flash, 0);

		// Hours, closed days and the texts the studio had stay; the empty ones are filled.
		const hours = await hoursOf(tenant);
		assert.lengthOf(hours, 1);
		assert.equal(hours[0].opensAt.slice(0, 5), "09:00");
		const closures = await closuresOf(tenant);
		assert.lengthOf(closures, 1);
		assert.equal(closures[0].note, "Own holiday");
		const row = await tenantRow(tenant);
		assert.equal(row.walkInsText, "Own walk-in words");
		assert.equal(row.contactPhone, "+9779811111111");
		assert.equal(row.depositPolicy, "Own deposit words");
		for (const text of [
			row.ageRuleText,
			row.beforeSessionText,
			row.aftercareText,
		]) {
			assert.isAbove((text ?? "").length, 20);
		}
	}).timeout(SLOW);

	test("tops a Solo studio up only to its package's one artist", async ({
		assert,
	}) => {
		const { tenant } = await studio("solo");
		await asOwner("update tenants set selected_package = 'solo' where id = ?", [
			tenant.id,
		]);

		await seed(tenant);

		const artists = await shown(tenant);
		assert.deepEqual(
			artists.map(({ artist }) => artist.name),
			["Sita Rai"],
		);
		assert.lengthOf(artists[0].photos, 8);
		assert.lengthOf(artists[0].flash, 6);
	}).timeout(SLOW);

	test("gives a Solo studio whose one artist is hidden no demo artist", async ({
		assert,
	}) => {
		const { tenant, owner } = await studio("solo-hidden");
		await asOwner("update tenants set selected_package = 'solo' where id = ?", [
			tenant.id,
		]);
		const hidden = await addArtist(tenant, owner, {
			name: "Hidden One",
			slug: "hidden-one",
			visible: false,
		});

		await seed(tenant);

		// A hidden artist still counts toward the package's limit, as on the dashboard.
		const all = await inTenant(tenant, () =>
			Artist.query().where("tenant_id", tenant.id),
		);
		assert.deepEqual(
			all.map((artist) => artist.id),
			[hidden.id],
		);
	}).timeout(SLOW);

	test("writes only the studios it is given, whatever other studios hold", async ({
		assert,
	}) => {
		const { tenant: other } = await studio("other");
		const { tenant: target } = await studio("target");
		const { tenant: left } = await studio("left");
		// A studio already full of artists, photos and designs does not make another look done.
		await seed(other);
		const otherBefore = await dump(other);
		const leftBefore = await dump(left);

		await seed(target);

		const artists = await shown(target);
		assert.lengthOf(artists, 3);
		for (const { photos, flash } of artists) {
			assert.lengthOf(photos, 8);
			assert.lengthOf(flash, 6);
		}
		assert.deepEqual(await dump(other), otherBefore);
		// A studio that was not given is untouched: no rows of any kind.
		assert.deepEqual(await dump(left), leftBefore);
		assert.lengthOf((await dump(left)).artists, 0);
		assert.lengthOf((await dump(left)).hours, 0);
		assert.deepEqual(await storedImages(left, "artist_work_photo"), []);
		assert.deepEqual(await storedImages(left, "flash_design"), []);

		// Every row written for the target carries the target's id.
		const { rows } = await asOwner(
			`select
				(select count(*)::int from artists where tenant_id = ?) as artists,
				(select count(*)::int from artist_work_photos where tenant_id = ?) as photos,
				(select count(*)::int from flash_designs where tenant_id = ?) as flash,
				(select count(*)::int from artist_work_photos p join artists a on a.id = p.artist_id where p.tenant_id = ? and a.tenant_id <> p.tenant_id) as crossed`,
			[target.id, target.id, target.id, target.id],
		);
		assert.deepEqual(rows[0], {
			artists: 3,
			photos: 24,
			flash: 18,
			crossed: 0,
		});
	}).timeout(SLOW);
});
