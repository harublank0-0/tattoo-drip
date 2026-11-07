import ace from "@adonisjs/core/services/ace";
import testUtils from "@adonisjs/core/services/test_utils";
import type { ApiClient } from "@japa/api-client";
import { test } from "@japa/runner";
import type User from "#models/user";
import Artist from "#modules/artists/models/artist";
import ArtistWorkPhoto from "#modules/artists/models/artist_work_photo";
import ArtistService from "#modules/artists/services/artist_service";
import { LISTING_CONSENT_VERSION } from "#modules/discovery/publication";
import PublicationService from "#modules/discovery/services/publication_service";
import ImageService from "#modules/media/services/image_service";
import Tenant from "#modules/tenancy/models/tenant";
import TenancyService from "#modules/tenancy/services/tenancy_service";
import { dbClient } from "#services/db_context";
import { addArtist, addWorkPhoto } from "#tests/helpers/artists";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";
import { assertValidationError } from "#tests/helpers/validation";

/**
 * Studio OS publication controls (Discover D04,
 * docs/discover/publication-controls.md) against PostgreSQL: every write
 * goes through the dashboard's routes, and every effect is checked where it
 * matters, at the public Discover API (the D02 views), never by trusting a
 * flag. Fixtures are written in each studio's context, as the app writes
 * them.
 */

const publication = () =>
	new PublicationService(
		new ImageService(),
		new ArtistService(new ImageService()),
	);

const reload = (tenant: { id: string }) =>
	inTenant(tenant, () => Tenant.findOrFail(tenant.id));

async function placeId(slug = "kathmandu"): Promise<string> {
	const { rows } = await dbClient().rawQuery(
		"select id from places where country_code = 'NP' and slug = ?",
		[slug],
	);
	return rows[0].id;
}

const settings = (client: ApiClient, user: User, slug: string) =>
	client.get(`/t/${slug}/settings/discover`).withInertia().loginAs(user);

function send(
	client: ApiClient,
	user: User,
	method: "put" | "post" | "delete",
	path: string,
	body?: Record<string, unknown>,
) {
	const request = client[method](path).withCsrfToken();
	if (body) request.form(body);
	return request.loginAs(user).redirects(0);
}

const setCity = (
	client: ApiClient,
	user: User,
	slug: string,
	id: string | null,
) =>
	send(client, user, "put", `/t/${slug}/settings/discover/place`, {
		placeId: id ?? "",
	});

const turnOn = (
	client: ApiClient,
	user: User,
	slug: string,
	body: Record<string, unknown> = {
		consent: "on",
		consentVersion: LISTING_CONSENT_VERSION,
	},
) => send(client, user, "post", `/t/${slug}/settings/discover/listing`, body);

const turnOff = (client: ApiClient, user: User, slug: string) =>
	send(client, user, "delete", `/t/${slug}/settings/discover/listing`);

const artistSwitch = (
	client: ApiClient,
	user: User,
	slug: string,
	artistId: string,
	listed: boolean,
) =>
	send(client, user, "put", `/t/${slug}/artists/${artistId}/discover`, {
		// As the profile form sends it.
		listed: listed ? "true" : "false",
	});

/** The public Discover API's answer status for a path. */
const publicStatus = async (client: ApiClient, path: string) =>
	(await client.get(`/api/v1/discover${path}`)).status();

/** A studio with one artist and two published photos, not listed. */
async function studio(slug: string, name = "Black Needle") {
	const { owner, tenant } = await studioWithOwner(slug, name);
	const sita = await addArtist(tenant, owner, {
		name: "Sita Rai",
		slug: "sita",
		styles: ["blackwork"],
	});
	const [first, second] = await inTenant(tenant, async () => [
		await addWorkPhoto(tenant, sita, { styles: ["blackwork"] }),
		await addWorkPhoto(tenant, sita),
	]);
	return { owner, tenant, sita, photos: [first, second] };
}

/** Lists `slug` through the dashboard: a city, then consent. */
async function listThroughDashboard(
	client: ApiClient,
	owner: User,
	slug: string,
) {
	(await setCity(client, owner, slug, await placeId())).assertStatus(302);
	(await turnOn(client, owner, slug)).assertStatus(302);
}

test.group("Discover settings: the listing", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a studio starts off Discover; the page says what is needed", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studio("d04-start");

		const response = await settings(client, owner, tenant.slug);

		response.assertStatus(200);
		const props = response.inertiaProps;
		assert.equal(props.status.key, "not_listed");
		assert.deepInclude(props.listing, {
			optedIn: false,
			takenDown: false,
			publiclyVisible: false,
			canEnable: false,
		});
		assert.equal(props.consent.version, LISTING_CONSENT_VERSION);
		assert.isTrue(props.consent.draft);
		assert.isNull(props.consent.accepted);
		assert.deepInclude(props.readiness.items[0], {
			key: "location",
			required: true,
			met: false,
		});
		assert.isAbove(props.places.length, 0);
		assert.isFalse((await reload(tenant)).discoveryListed);
		assert.equal(await publicStatus(client, `/studios/${tenant.slug}`), 404);
	});

	test("an owner lists with consent and a city: recorded, and the public API returns the studio", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, sita, photos } = await studio("d04-list");

		(await setCity(client, owner, tenant.slug, await placeId())).assertStatus(
			302,
		);
		assert.equal(
			(await settings(client, owner, tenant.slug)).inertiaProps.status.key,
			"eligible",
		);
		(await turnOn(client, owner, tenant.slug)).assertStatus(302);

		const live = await reload(tenant);
		assert.isTrue(live.discoveryListed);
		assert.isNotNull(live.discoveryListedAt);
		assert.equal(live.discoveryConsentVersion, LISTING_CONSENT_VERSION);
		assert.equal(live.discoveryConsentedByUserId, owner.id);
		assert.equal(await publicStatus(client, `/studios/${tenant.slug}`), 200);
		assert.equal(
			await publicStatus(
				client,
				`/studios/${tenant.slug}/artists/${sita.slug}`,
			),
			200,
		);
		assert.equal(await publicStatus(client, `/tattoos/${photos[0].id}`), 200);

		const props = (await settings(client, owner, tenant.slug)).inertiaProps;
		assert.equal(props.status.key, "listed");
		assert.isTrue(props.listing.publiclyVisible);
		assert.deepInclude(props.consent.accepted, {
			version: LISTING_CONSENT_VERSION,
			current: true,
		});
		assert.equal(props.artists[0].state, "shown");
	});

	test("no consent, another version or no city: refused, nothing listed", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studio("d04-refuse");

		// No city yet.
		const noCity = await turnOn(client, owner, tenant.slug);
		assertValidationError(noCity, "placeId");

		(await setCity(client, owner, tenant.slug, await placeId())).assertStatus(
			302,
		);
		assertValidationError(
			await turnOn(client, owner, tenant.slug, {
				consentVersion: LISTING_CONSENT_VERSION,
			}),
			"consent",
		);
		assertValidationError(
			await turnOn(client, owner, tenant.slug, {
				consent: "on",
				consentVersion: "2020-01-01.old",
			}),
			"consent",
		);
		assertValidationError(
			await turnOn(client, owner, tenant.slug, { consent: "on" }),
			"consentVersion",
		);

		const live = await reload(tenant);
		assert.isFalse(live.discoveryListed);
		assert.isNull(live.discoveryConsentVersion);
		assert.equal(await publicStatus(client, `/studios/${tenant.slug}`), 404);
	});

	test("turning it off hides the studio, its artists and photos; the studio page and records stay", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, sita, photos } = await studio("d04-off");
		await listThroughDashboard(client, owner, tenant.slug);

		(await turnOff(client, owner, tenant.slug)).assertStatus(302);

		assert.equal(await publicStatus(client, `/studios/${tenant.slug}`), 404);
		assert.equal(
			await publicStatus(
				client,
				`/studios/${tenant.slug}/artists/${sita.slug}`,
			),
			404,
		);
		assert.equal(await publicStatus(client, `/tattoos/${photos[0].id}`), 404);
		// The studio page (storefront API) and every record are unchanged.
		(await client.get(`/api/v1/tenants/${tenant.slug}`)).assertStatus(200);
		(
			await client.get(`/api/v1/tenants/${tenant.slug}/work/${photos[0].id}`)
		).assertStatus(200);
		const live = await reload(tenant);
		assert.isFalse(live.discoveryListed);
		// The last consent stays on record...
		assert.equal(live.discoveryConsentVersion, LISTING_CONSENT_VERSION);
		const artists = await inTenant(tenant, () =>
			Artist.query().where("tenant_id", tenant.id),
		);
		assert.lengthOf(artists, 1);
		assert.isTrue(artists[0].discoveryListed);
		// ...but turning it on again asks for consent again.
		assertValidationError(
			await turnOn(client, owner, tenant.slug, {
				consentVersion: LISTING_CONSENT_VERSION,
			}),
			"consent",
		);
		assert.equal(
			(await settings(client, owner, tenant.slug)).inertiaProps.status.key,
			"eligible",
		);
	});

	test("the city can't be removed while listed, and can after", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studio("d04-city");
		await listThroughDashboard(client, owner, tenant.slug);

		assertValidationError(
			await setCity(client, owner, tenant.slug, null),
			"placeId",
		);
		assert.equal((await reload(tenant)).placeId, await placeId());

		(await turnOff(client, owner, tenant.slug)).assertStatus(302);
		(await setCity(client, owner, tenant.slug, null)).assertStatus(302);
		assert.isNull((await reload(tenant)).placeId);
		assertValidationError(
			await setCity(
				client,
				owner,
				tenant.slug,
				"00000000-0000-4000-8000-000000000000",
			),
			"placeId",
		);
	});

	test("an artist member and another studio's owner get a 404 on every settings route, changing nothing", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studio("d04-roles");
		await inTenant(tenant, () =>
			dbClient().rawQuery("update tenants set place_id = null where id = ?", [
				tenant.id,
			]),
		);
		const artist = await artistIn(tenant, "artist@d04-roles.example");
		const other = await studioWithOwner("d04-roles-other", "Other");
		const city = await placeId();

		for (const user of [artist, other.owner]) {
			(await settings(client, user, tenant.slug)).assertStatus(404);
			(
				await client
					.get(`/t/${tenant.slug}/settings/discover/preview`)
					.loginAs(user)
			).assertStatus(404);
			(await setCity(client, user, tenant.slug, city)).assertStatus(404);
			(await turnOn(client, user, tenant.slug)).assertStatus(404);
			(await turnOff(client, user, tenant.slug)).assertStatus(404);
		}
		const live = await reload(tenant);
		assert.isFalse(live.discoveryListed);
		assert.isNull(live.placeId);
		void owner;
	});
});

test.group("Discover settings: takedowns", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a takedown overrides the owner's listing; the owner can't lift it; a restore follows the owner's switch", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studio("d04-takedown");
		await listThroughDashboard(client, owner, tenant.slug);

		await publication().suspendStudio(tenant.slug, "Copyright complaint #12");

		assert.equal(await publicStatus(client, `/studios/${tenant.slug}`), 404);
		const page = await settings(client, owner, tenant.slug);
		assert.equal(page.inertiaProps.status.key, "taken_down");
		assert.isTrue(page.inertiaProps.listing.takenDown);
		// The operator's reason never reaches the dashboard.
		assert.notInclude(JSON.stringify(page.inertiaProps), "Copyright complaint");

		// Whatever the owner does, the takedown stays.
		(await turnOff(client, owner, tenant.slug)).assertStatus(302);
		(await turnOn(client, owner, tenant.slug)).assertStatus(302);
		const live = await reload(tenant);
		assert.isNotNull(live.discoverySuspendedAt);
		assert.equal(live.discoverySuspensionNote, "Copyright complaint #12");
		assert.equal(await publicStatus(client, `/studios/${tenant.slug}`), 404);

		// Lifted while the owner's listing is on: back on Discover.
		await publication().restoreStudio(tenant.slug);
		assert.equal(await publicStatus(client, `/studios/${tenant.slug}`), 200);

		// Lifted while the owner's listing is off: stays off.
		await publication().suspendStudio(tenant.slug, "Again");
		(await turnOff(client, owner, tenant.slug)).assertStatus(302);
		await publication().restoreStudio(tenant.slug);
		assert.equal(await publicStatus(client, `/studios/${tenant.slug}`), 404);
		assert.equal(
			(await settings(client, owner, tenant.slug)).inertiaProps.status.key,
			"eligible",
		);
	});

	test("a photo takedown removes only that photo from Discover; it stays on the studio page", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, photos } = await studio("d04-photo");
		await listThroughDashboard(client, owner, tenant.slug);

		await publication().suspendPhoto(tenant.slug, photos[0].id, "DMCA");

		assert.equal(await publicStatus(client, `/tattoos/${photos[0].id}`), 404);
		assert.equal(await publicStatus(client, `/tattoos/${photos[1].id}`), 200);
		assert.equal(await publicStatus(client, `/studios/${tenant.slug}`), 200);
		(
			await client.get(`/api/v1/tenants/${tenant.slug}/work/${photos[0].id}`)
		).assertStatus(200);
		const stored = await inTenant(tenant, () =>
			ArtistWorkPhoto.findOrFail(photos[0].id),
		);
		assert.isFalse(stored.hidden);

		const portfolio = await client
			.get(`/t/${tenant.slug}/portfolio`)
			.withInertia()
			.loginAs(owner);
		const states = Object.fromEntries(
			portfolio.inertiaProps.photos.map(
				(photo: { id: string; discoverState: string }) => [
					photo.id,
					photo.discoverState,
				],
			),
		);
		assert.deepEqual(states, {
			[photos[0].id]: "removed",
			[photos[1].id]: "visible",
		});
		assert.notInclude(JSON.stringify(portfolio.inertiaProps), "DMCA");

		await publication().restorePhoto(tenant.slug, photos[0].id);
		assert.equal(await publicStatus(client, `/tattoos/${photos[0].id}`), 200);
	});

	test("the operator commands take down, report and restore; bad input changes nothing", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, photos } = await studio("d04-ace");
		await listThroughDashboard(client, owner, tenant.slug);

		const noReason = await ace.exec("discover:suspend", [tenant.slug]);
		assert.equal(noReason.exitCode, 1);
		const unknown = await ace.exec("discover:suspend", [
			"d04-no-such-studio",
			"--reason",
			"x",
		]);
		assert.equal(unknown.exitCode, 1);
		assert.isNull((await reload(tenant)).discoverySuspendedAt);

		const photo = await ace.exec("discover:suspend", [
			tenant.slug,
			"--photo",
			photos[0].id,
			"--reason",
			"Complaint",
		]);
		photo.assertSucceeded();
		assert.equal(await publicStatus(client, `/tattoos/${photos[0].id}`), 404);

		const whole = await ace.exec("discover:suspend", [
			tenant.slug,
			"--reason",
			"Fake listing",
		]);
		whole.assertSucceeded();
		assert.equal(await publicStatus(client, `/studios/${tenant.slug}`), 404);

		(await ace.exec("discover:status", [tenant.slug])).assertSucceeded();

		(await ace.exec("discover:restore", [tenant.slug])).assertSucceeded();
		(
			await ace.exec("discover:restore", [tenant.slug, "--photo", photos[0].id])
		).assertSucceeded();
		assert.equal(await publicStatus(client, `/studios/${tenant.slug}`), 200);
		assert.equal(await publicStatus(client, `/tattoos/${photos[0].id}`), 200);
	});
});

test.group("Discover settings: artists", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an owner turns an unlinked artist off and on; Discover follows, nothing else changes", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, sita, photos } = await studio("d04-artist");
		await listThroughDashboard(client, owner, tenant.slug);
		const artistPath = `/studios/${tenant.slug}/artists/${sita.slug}`;

		(
			await artistSwitch(client, owner, tenant.slug, sita.id, false)
		).assertStatus(302);
		assert.equal(await publicStatus(client, artistPath), 404);
		assert.equal(await publicStatus(client, `/tattoos/${photos[0].id}`), 404);
		assert.equal(await publicStatus(client, `/studios/${tenant.slug}`), 200);
		const kept = await inTenant(tenant, () => Artist.findOrFail(sita.id));
		assert.isTrue(kept.visible);
		assert.isNull(kept.deletedAt);
		// Still on the studio page.
		(
			await client.get(`/api/v1/tenants/${tenant.slug}/work/${photos[0].id}`)
		).assertStatus(200);

		(
			await artistSwitch(client, owner, tenant.slug, sita.id, true)
		).assertStatus(302);
		assert.equal(await publicStatus(client, artistPath), 200);
	});

	test("a linked artist manages their own switch; an owner may turn them off but not back on", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studio("d04-linked");
		const member = await artistIn(tenant, "mira@d04-linked.example");
		const mira = await addArtist(tenant, member, {
			name: "Mira",
			slug: "mira",
			linkToMe: true,
		});

		(
			await artistSwitch(client, member, tenant.slug, mira.id, false)
		).assertStatus(302);
		assertValidationError(
			await artistSwitch(client, owner, tenant.slug, mira.id, true),
			"listed",
		);
		const off = await inTenant(tenant, () => Artist.findOrFail(mira.id));
		assert.isFalse(off.discoveryListed);

		(
			await artistSwitch(client, member, tenant.slug, mira.id, true)
		).assertStatus(302);
		(
			await artistSwitch(client, owner, tenant.slug, mira.id, false)
		).assertStatus(302);
		const page = await client
			.get(`/t/${tenant.slug}/artists/${mira.id}/edit`)
			.withInertia()
			.loginAs(owner);
		assert.deepInclude(page.inertiaProps.discover, {
			listed: false,
			canTurnOn: false,
			independent: false,
		});
	});

	test("an artist can't change another profile; another studio's artist is a 404", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, sita } = await studio("d04-artist-iso");
		const member = await artistIn(tenant, "rita@d04-artist-iso.example");
		await addArtist(tenant, member, {
			name: "Rita",
			slug: "rita",
			linkToMe: true,
		});
		const other = await studio("d04-artist-iso-b", "Other Studio");

		(
			await artistSwitch(client, member, tenant.slug, sita.id, false)
		).assertStatus(404);
		(
			await artistSwitch(client, owner, tenant.slug, other.sita.id, false)
		).assertStatus(404);
		(
			await artistSwitch(client, owner, other.tenant.slug, other.sita.id, false)
		).assertStatus(404);
		const untouched = await inTenant(other.tenant, () =>
			Artist.findOrFail(other.sita.id),
		);
		assert.isTrue(untouched.discoveryListed);
		const own = await inTenant(tenant, () => Artist.findOrFail(sita.id));
		assert.isTrue(own.discoveryListed);
	});

	test("an independent artist lists with one switch and shows as an artist", async ({
		client,
		assert,
	}) => {
		const { owner } = await studioWithOwner("d04-solo-owner", "Owner");
		const solo = await new TenancyService().createTenant(owner, {
			type: "independent",
			name: "Asha Solo",
			slug: "d04-asha-solo",
			timezone: "Asia/Kathmandu",
		});
		const profile = await inTenant(solo, () =>
			Artist.query().where("tenant_id", solo.id).firstOrFail(),
		);
		// An old opt-out of their only profile: the one switch overrides it.
		await inTenant(solo, () =>
			Artist.query()
				.where("id", profile.id)
				.update({ discovery_listed: false }),
		);

		await listThroughDashboard(client, owner, solo.slug);

		assert.equal(await publicStatus(client, `/artists/${solo.slug}`), 200);
		assert.equal(await publicStatus(client, `/studios/${solo.slug}`), 404);
		const props = (await settings(client, owner, solo.slug)).inertiaProps;
		assert.equal(props.business.type, "independent");
		assert.equal(props.status.key, "listed");
		assert.deepEqual(props.artists, []);
		assert.notInclude(
			props.readiness.items.map((item: { key: string }) => item.key),
			"artists",
		);
		const page = await client
			.get(`/t/${solo.slug}/artists/${profile.id}/edit`)
			.withInertia()
			.loginAs(owner);
		assert.isTrue(page.inertiaProps.discover.independent);
	});
});

test.group("Discover settings: preview", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an owner previews before listing: their real public data, nothing private or unpublished", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, sita, photos } = await studio("d04-preview");
		await inTenant(tenant, () =>
			Tenant.query().where("id", tenant.id).update({
				intro: "Fine line and blackwork in Thamel.",
				contact_phone: "+9779800000000",
				contact_email: "hello@d04-preview.example",
			}),
		);
		const hidden = await inTenant(tenant, () =>
			addWorkPhoto(tenant, sita, { hidden: true }),
		);
		const optedOut = await addArtist(tenant, owner, {
			name: "Opted Out",
			slug: "opted-out",
		});
		await inTenant(tenant, () =>
			Artist.query()
				.where("id", optedOut.id)
				.update({ discovery_listed: false }),
		);

		const response = await client
			.get(`/t/${tenant.slug}/settings/discover/preview`)
			.withInertia()
			.loginAs(owner);

		response.assertStatus(200);
		const { preview, status } = response.inertiaProps;
		assert.equal(status.key, "not_listed");
		assert.equal(preview.name, "Black Needle");
		assert.equal(preview.intro, "Fine line and blackwork in Thamel.");
		assert.deepEqual(
			preview.artists.map((artist: { id: string }) => artist.id),
			[sita.id],
		);
		assert.sameMembers(
			preview.tattoos.map((tattoo: { id: string }) => tattoo.id),
			photos.map((photo) => photo.id),
		);
		assert.notInclude(
			preview.tattoos.map((tattoo: { id: string }) => tattoo.id),
			hidden.id,
		);
		const body = JSON.stringify(response.inertiaProps);
		for (const word of ["+9779800000000", "hello@d04-preview", "Opted Out"]) {
			assert.notInclude(body, word);
		}
		assert.include(preview.bookingUrl, "/book");
	});
});
