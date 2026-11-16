import type { ApiClient } from "@japa/api-client";
import type User from "#models/user";
import { LISTING_CONSENT_VERSION } from "#modules/discovery/publication";
import { dbClient } from "#services/db_context";
import { addArtist, addWorkPhoto } from "#tests/helpers/artists";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

/** Discover fixtures and dashboard calls shared by the Discover specs. */

export async function placeId(slug = "kathmandu"): Promise<string> {
	const { rows } = await dbClient().rawQuery(
		"select id from places where country_code = 'NP' and slug = ?",
		[slug],
	);
	return rows[0].id;
}

export function send(
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

export const setCity = (
	client: ApiClient,
	user: User,
	slug: string,
	id: string | null,
) =>
	send(client, user, "put", `/t/${slug}/settings/discover/place`, {
		placeId: id ?? "",
	});

export const turnOn = (
	client: ApiClient,
	user: User,
	slug: string,
	body: Record<string, unknown> = {
		consent: "on",
		consentVersion: LISTING_CONSENT_VERSION,
	},
) => send(client, user, "post", `/t/${slug}/settings/discover/listing`, body);

export const turnOff = (client: ApiClient, user: User, slug: string) =>
	send(client, user, "delete", `/t/${slug}/settings/discover/listing`);

/** The public Discover API's answer status for a path. */
export const publicStatus = async (client: ApiClient, path: string) =>
	(await client.get(`/api/v1/discover${path}`)).status();

/** A studio with one artist and two published photos, not listed. */
export async function studio(slug: string, name = "Black Needle") {
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
export async function listThroughDashboard(
	client: ApiClient,
	owner: User,
	slug: string,
) {
	(await setCity(client, owner, slug, await placeId())).assertStatus(302);
	(await turnOn(client, owner, slug)).assertStatus(302);
}
