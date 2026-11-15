import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import User from "#models/user";
import Artist from "#modules/artists/models/artist";
import ArtistService from "#modules/artists/services/artist_service";
import DiscoveryService from "#modules/discovery/services/discovery_service";
import ImageService from "#modules/media/services/image_service";
import type Tenant from "#modules/tenancy/models/tenant";
import TenancyService from "#modules/tenancy/services/tenancy_service";
import { dbClient } from "#services/db_context";
import env from "#start/env";
import { addArtist } from "#tests/helpers/artists";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";

/**
 * Archiving artists from the dashboard (studio packages, phase 2): owners
 * archive and restore; an archived artist leaves every public surface; adding
 * or restoring an artist goes through the package gate.
 */

const artists = new ArtistService(new ImageService());

const rowOf = (tenant: Tenant, id: string) =>
	inTenant(tenant, () => Artist.findOrFail(id));

/** Lists the studio on Discover, as discover_sitemap.spec.ts does. */
const listOnDiscover = (tenant: Tenant) =>
	inTenant(tenant, () =>
		dbClient().rawQuery(
			`update tenants set discovery_listed = true, discovery_listed_at = ?,
			 place_id = (select id from places where country_code = 'NP' and slug = 'kathmandu')
			 where id = ?`,
			[DateTime.utc().toJSDate(), tenant.id],
		),
	);

/** An independent artist's workspace: Solo, with the owner's own profile. */
async function soloWorkspace(slug: string) {
	const owner = await User.create({
		email: `owner@${slug}.example`,
		password: "secret-password",
		emailVerifiedAt: DateTime.utc(),
	});
	const tenant = await new TenancyService().createTenant(owner, {
		type: "independent",
		name: slug,
		slug,
		timezone: "Asia/Kathmandu",
	});
	return { owner, tenant };
}

test.group("Artists: archiving from the dashboard", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.teardown(() => {
		env.set("PACKAGE_ENFORCEMENT", undefined as never);
	});

	test("an owner archives and restores an artist; an artist can't", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("arch-http-a", "Arch A");
		const member = await artistIn(tenant, "artist@arch-http-a.example");
		const sita = await addArtist(tenant, owner);
		const base = `/t/${tenant.slug}/artists`;

		for (const action of ["archive", "restore"]) {
			const refused = await client
				.post(`${base}/${sita.id}/${action}`)
				.withCsrfToken()
				.loginAs(member);
			refused.assertStatus(404);
		}
		assert.isNull((await rowOf(tenant, sita.id)).archivedAt);

		const archived = await client
			.post(`${base}/${sita.id}/archive`)
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);
		archived.assertHeader("location", base);
		archived.assertFlashMessage("success", '"Sita Rai" archived.');
		const row = await rowOf(tenant, sita.id);
		assert.isNotNull(row.archivedAt);
		assert.isFalse(row.visible);

		const page = await client.get(base).withInertia().loginAs(owner);
		assert.isTrue(
			page.inertiaProps.artists.find(({ id }: { id: string }) => id === sita.id)
				.archived,
		);

		const restored = await client
			.post(`${base}/${sita.id}/restore`)
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);
		restored.assertHeader("location", base);
		restored.assertFlashMessage(
			"success",
			'"Sita Rai" is active again. They stay hidden until you show them on your page.',
		);
		const back = await rowOf(tenant, sita.id);
		assert.isNull(back.archivedAt);
		assert.isFalse(back.visible);
	});

	test("an archived artist leaves the studio page and Discover", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("arch-http-b", "Arch B");
		const asha = await addArtist(tenant, owner, { name: "Asha", slug: "asha" });
		const bina = await addArtist(tenant, owner, { name: "Bina", slug: "bina" });
		await listOnDiscover(tenant);
		const discovery = new DiscoveryService(new ImageService());
		const publicSlugs = async () =>
			(
				await client
					.get(`/api/v1/tenants/${tenant.slug}/artists`)
					.header("x-forwarded-for", "198.51.100.40")
			)
				.body()
				.data.map(({ slug }: { slug: string }) => slug);
		const discoverSlugs = async () =>
			((await discovery.studioArtists(tenant.slug)) ?? []).map(
				({ slug }) => slug,
			);

		assert.sameMembers(await publicSlugs(), ["asha", "bina"]);
		assert.sameMembers(await discoverSlugs(), ["asha", "bina"]);

		await inTenant(tenant, () => artists.archive(tenant, bina.id));

		assert.deepEqual(await publicSlugs(), ["asha"]);
		assert.deepEqual(await discoverSlugs(), ["asha"]);
		assert.equal(asha.slug, "asha");
	});

	test("adding an artist past Solo's limit is refused in enforce mode and only logged in observe mode", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await soloWorkspace("arch-http-solo");
		const base = `/t/${tenant.slug}/artists`;
		const count = () => inTenant(tenant, () => artists.countActive(tenant));
		assert.equal(await count(), 1);

		env.set("PACKAGE_ENFORCEMENT", "enforce");
		const refused = await client
			.post(base)
			.fields({ name: "Bina", slug: "bina" })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);
		refused.assertFlashMessage(
			"error",
			"Solo includes one active artist. Archive an artist, or upgrade to Studio.",
		);
		assert.equal(await count(), 1);

		env.set("PACKAGE_ENFORCEMENT", "observe");
		const added = await client
			.post(base)
			.fields({ name: "Bina", slug: "bina" })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);
		added.assertFlashMessage("success", '"Bina" added.');
		assert.equal(await count(), 2);

		// Archive one, add nothing: restoring it would pass the limit again.
		const bina = await inTenant(tenant, () =>
			Artist.query().where("slug", "bina").firstOrFail(),
		);
		await inTenant(tenant, () => artists.archive(tenant, bina.id));
		env.set("PACKAGE_ENFORCEMENT", "enforce");
		const restore = await client
			.post(`${base}/${bina.id}/restore`)
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);
		restore.assertFlashMessage(
			"error",
			"Solo includes one active artist. Archive an artist, or upgrade to Studio.",
		);
		assert.isNotNull((await rowOf(tenant, bina.id)).archivedAt);
	});
});
