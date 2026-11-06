import testUtils from "@adonisjs/core/services/test_utils";
import type { ApiClient } from "@japa/api-client";
import { test } from "@japa/runner";
import type User from "#models/user";
import type Tenant from "#modules/tenancy/models/tenant";
import { addArtist, addWorkPhoto } from "#tests/helpers/artists";
import { makeClient } from "#tests/helpers/pipeline";
import { recordQueries } from "#tests/helpers/query_count";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

/** How many queries one page view costs. */
async function cost(client: ApiClient, url: string, user: User) {
	const { result, queries } = await recordQueries(() =>
		client.get(url).withInertia().loginAs(user),
	);
	result.assertStatus(200);
	return queries.length;
}

/** `artists` more artists, each with `photos` photos, and `clients` clients. */
async function grow(
	tenant: Tenant,
	owner: User,
	n: { artists: number; photos: number; clients: number },
	from: number,
) {
	for (let a = 0; a < n.artists; a += 1) {
		const artist = await addArtist(tenant, owner, {
			name: `Artist ${from + a}`,
			slug: `artist-${from + a}`,
		});
		await inTenant(tenant, async () => {
			for (let p = 0; p < n.photos; p += 1) await addWorkPhoto(tenant, artist);
		});
	}
	await inTenant(tenant, async () => {
		for (let c = 0; c < n.clients; c += 1) {
			await makeClient(tenant, { name: `Client ${from + c}` });
		}
	});
}

/**
 * Studio OS's list pages read in a fixed number of queries (grouped reads,
 * no query per row): the same for one artist, photo and client as for
 * several. A page that starts reading per row fails here.
 */
test.group("Studio OS pages: no query per row", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("Portfolio, Artists, Clients and Today cost the same for one row as for many", async ({
		client,
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner("os-queries", "OS Queries");
		const pages = [
			"/t/os-queries/portfolio",
			"/t/os-queries/portfolio?status=published&q=a",
			"/t/os-queries/artists",
			"/t/os-queries/clients",
			"/t/os-queries/today",
		];
		await grow(tenant, owner, { artists: 1, photos: 1, clients: 1 }, 0);
		const small: number[] = [];
		for (const url of pages) small.push(await cost(client, url, owner));

		await grow(tenant, owner, { artists: 4, photos: 6, clients: 8 }, 10);
		for (const [index, url] of pages.entries()) {
			assert.equal(await cost(client, url, owner), small[index], url);
		}
	});
});
