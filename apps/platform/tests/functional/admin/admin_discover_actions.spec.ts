import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import ArtistService from "#modules/artists/services/artist_service";
import PublicationService from "#modules/discovery/services/publication_service";
import ImageService from "#modules/media/services/image_service";
import { adminUser } from "#tests/helpers/admin";
import {
	listThroughDashboard,
	publicStatus,
	send,
	studio,
} from "#tests/helpers/discover";
import { assertValidationError } from "#tests/helpers/validation";

const publication = () =>
	new PublicationService(
		new ImageService(),
		new ArtistService(new ImageService()),
	);

const SUSPENDED =
	"The listing is off Discover. The studio page and bookings are unchanged. Public caches can keep it for up to two minutes.";
const PHOTO_SUSPENDED =
	"The photo is off Discover. It stays on the studio page. Public caches can keep it for up to two minutes.";

test.group("Admin Discover actions", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("suspending then restoring the listing takes it off and back on Discover", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studio("adm-listing");
		await listThroughDashboard(client, owner, tenant.slug);
		const admin = await adminUser();
		const base = `/admin/studios/${tenant.slug}/discover`;
		assert.equal(await publicStatus(client, `/studios/${tenant.slug}`), 200);

		const off = await send(client, admin, "post", `${base}/suspend`, {
			reason: "  Copyright complaint #12 ",
		});
		off.assertStatus(302);
		off.assertFlashMessage("success", SUSPENDED);
		assert.equal(await publicStatus(client, `/studios/${tenant.slug}`), 404);
		const status = await publication().operatorStatus(tenant.slug);
		assert.equal(status.takedown?.note, "Copyright complaint #12");

		const on = await send(client, admin, "post", `${base}/restore`);
		on.assertStatus(302);
		on.assertFlashMessage(
			"success",
			`Takedown lifted. The listing is now: ${(await publication().operatorStatus(tenant.slug)).status}.`,
		);
		assert.equal(await publicStatus(client, `/studios/${tenant.slug}`), 200);
		assert.isNull((await publication().operatorStatus(tenant.slug)).takedown);
	});

	test("a restore says when the owner's own listing is off", async ({
		client,
	}) => {
		const { tenant } = await studio("adm-owner-off");
		const admin = await adminUser();
		const base = `/admin/studios/${tenant.slug}/discover`;
		await send(client, admin, "post", `${base}/suspend`, { reason: "Why" });
		const on = await send(client, admin, "post", `${base}/restore`);
		on.assertFlashMessage(
			"success",
			`Takedown lifted. The listing is now: ${(await publication().operatorStatus(tenant.slug)).status} (the owner's listing is off).`,
		);
	});

	test("a photo can be taken off Discover and put back", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, photos } = await studio("adm-photo");
		await listThroughDashboard(client, owner, tenant.slug);
		const admin = await adminUser();
		const base = `/admin/studios/${tenant.slug}/photos/${photos[0].id}`;

		const off = await send(client, admin, "post", `${base}/suspend`, {
			reason: "DMCA",
		});
		off.assertStatus(302);
		off.assertFlashMessage("success", PHOTO_SUSPENDED);
		assert.deepEqual(
			(await publication().operatorStatus(tenant.slug)).removedPhotos.map(
				(photo) => photo.id,
			),
			[photos[0].id],
		);
		assert.equal(await publicStatus(client, `/tattoos/${photos[0].id}`), 404);

		const on = await send(client, admin, "post", `${base}/restore`);
		on.assertStatus(302);
		assert.equal(await publicStatus(client, `/tattoos/${photos[0].id}`), 200);
		assert.lengthOf(
			(await publication().operatorStatus(tenant.slug)).removedPhotos,
			0,
		);
	});

	test("an empty, blank or 501-character reason changes nothing", async ({
		client,
		assert,
	}) => {
		const { tenant, photos } = await studio("adm-reason");
		const admin = await adminUser();
		const paths = [
			`/admin/studios/${tenant.slug}/discover/suspend`,
			`/admin/studios/${tenant.slug}/photos/${photos[0].id}/suspend`,
		];
		for (const path of paths) {
			for (const reason of ["", "   ", "x".repeat(501)]) {
				const response = await send(client, admin, "post", path, { reason });
				response.assertStatus(302);
				assertValidationError(response, "reason");
			}
		}
		const status = await publication().operatorStatus(tenant.slug);
		assert.isNull(status.takedown);
		assert.lengthOf(status.removedPhotos, 0);
	});

	test("a refused reason comes back under the bag the form named", async ({
		client,
		assert,
	}) => {
		const { tenant, photos } = await studio("adm-bag");
		const admin = await adminUser();
		const bag = `photo-${photos[0].id}`;
		// Followed like the browser does: the redirect's GET keeps the header.
		const page = await client
			.post(`/admin/studios/${tenant.slug}/photos/${photos[0].id}/suspend`)
			.withCsrfToken()
			.form({ reason: "   " })
			.withInertia()
			.header("x-inertia-error-bag", bag)
			.header("referer", `/admin/studios/${tenant.slug}`)
			.loginAs(admin)
			.redirects(1);
		page.assertStatus(200);
		const errors = page.inertiaProps.errors as Record<string, unknown>;
		assert.deepEqual(Object.keys(errors), [bag]);
		assert.property(errors[bag] as object, "reason");
	});

	test("another studio's photo under this slug is refused and left alone", async ({
		client,
		assert,
	}) => {
		const a = await studio("adm-a", "Studio A");
		const b = await studio("adm-b", "Studio B");
		const admin = await adminUser();
		const path = `/admin/studios/${a.tenant.slug}/photos/${b.photos[0].id}`;

		const off = await send(client, admin, "post", `${path}/suspend`, {
			reason: "Wrong studio",
		});
		off.assertStatus(302);
		off.assertFlashMessage("error", "That studio has no photo with this id.");
		const lift = await send(client, admin, "post", `${path}/restore`);
		lift.assertFlashMessage("error", "That studio has no photo with this id.");
		assert.lengthOf(
			(await publication().operatorStatus(b.tenant.slug)).removedPhotos,
			0,
		);
	});

	test("an unknown studio or a malformed photo id is an error flash, not a 500", async ({
		client,
	}) => {
		const { tenant } = await studio("adm-bad");
		const admin = await adminUser();
		const gone = await send(
			client,
			admin,
			"post",
			"/admin/studios/no-such-studio/discover/restore",
		);
		gone.assertStatus(302);
		gone.assertFlashMessage("error", 'No studio uses "no-such-studio".');
		const bad = await send(
			client,
			admin,
			"post",
			`/admin/studios/${tenant.slug}/photos/not-a-uuid/suspend`,
			{ reason: "x" },
		);
		bad.assertStatus(302);
		bad.assertFlashMessage("error", "That studio has no photo with this id.");
	});

	test("restoring where nothing is taken down succeeds and changes nothing", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studio("adm-noop");
		await listThroughDashboard(client, owner, tenant.slug);
		const admin = await adminUser();
		const response = await send(
			client,
			admin,
			"post",
			`/admin/studios/${tenant.slug}/discover/restore`,
		);
		response.assertStatus(302);
		assert.equal(await publicStatus(client, `/studios/${tenant.slug}`), 200);
	});

	test("a studio owner gets a 404 on all four", async ({ client, assert }) => {
		const { owner, tenant, photos } = await studio("adm-owner");
		await listThroughDashboard(client, owner, tenant.slug);
		const base = `/admin/studios/${tenant.slug}`;
		for (const path of [
			`${base}/discover/suspend`,
			`${base}/discover/restore`,
			`${base}/photos/${photos[0].id}/suspend`,
			`${base}/photos/${photos[0].id}/restore`,
		]) {
			(
				await send(client, owner, "post", path, { reason: "Nope" })
			).assertStatus(404);
		}
		assert.isNull((await publication().operatorStatus(tenant.slug)).takedown);
	});
});
