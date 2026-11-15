import app from "@adonisjs/core/services/app";
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import {
	combineFacts,
	lastDays,
	type PilotTile,
	pilotTiles,
} from "#modules/reports/pilot_metrics";
import PilotMetricsService from "#modules/reports/services/pilot_metrics_service";
import { adminUser } from "#tests/helpers/admin";
import { makeClient, makeInquiry } from "#tests/helpers/pipeline";
import { inTenant, twoStudios } from "#tests/helpers/tenants";

type Props = {
	days: number;
	studios: { slug: string; name: string; tiles: PilotTile[] }[];
	total: { count: number; tiles: PilotTile[] };
};

test.group("Admin metrics", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("shows each studio's numbers and the total, the same as metrics:pilot", async ({
		client,
		assert,
	}) => {
		const { a, b } = await twoStudios();
		await inTenant(a.tenant, async () => {
			await makeInquiry(a.tenant, await makeClient(a.tenant));
		});
		const page = await client
			.get("/admin/metrics?days=42")
			.loginAs(await adminUser())
			.withInertia();
		page.assertStatus(200);
		const props = page.inertiaProps as unknown as Props;
		assert.equal(props.days, 42);

		const service = await app.container.make(PilotMetricsService);
		const window = lastDays(42);
		const mine = [a.tenant, b.tenant];
		const facts = [];
		for (const tenant of mine) {
			const shown = props.studios.find((row) => row.slug === tenant.slug);
			assert.exists(shown);
			assert.equal(shown?.name, tenant.name);
			const own = await inTenant(tenant, () =>
				service.forStudio(tenant, window),
			);
			facts.push(own);
			assert.deepEqual(shown?.tiles, pilotTiles(own));
		}
		assert.isAtLeast(props.total.count, 2);
		// The dev database may hold other studios: the total covers all listed.
		const all = [];
		for (const row of props.studios) {
			const tenant = mine.find((t) => t.slug === row.slug);
			if (tenant) {
				all.push(
					await inTenant(tenant, () => service.forStudio(tenant, window)),
				);
			}
		}
		assert.equal(props.total.count, props.studios.length);
		if (props.studios.length === 2) {
			assert.deepEqual(props.total.tiles, pilotTiles(combineFacts(all)));
		}
	});

	test("lists studios oldest first", async ({ client, assert }) => {
		const { a, b } = await twoStudios();
		const page = await client
			.get("/admin/metrics")
			.loginAs(await adminUser())
			.withInertia();
		const slugs = (page.inertiaProps as unknown as Props).studios.map(
			(row) => row.slug,
		);
		assert.isBelow(slugs.indexOf(a.tenant.slug), slugs.indexOf(b.tenant.slug));
	});

	test("no days means 42, with no error", async ({ client, assert }) => {
		const page = await client
			.get("/admin/metrics")
			.loginAs(await adminUser())
			.withInertia();
		page.assertStatus(200);
		assert.equal((page.inertiaProps as unknown as Props).days, 42);
		assert.isUndefined(page.flashMessage("error"));
	});

	test("a days that isn't a whole number from 1 to 3650 renders 42 with an error, not a redirect", async ({
		client,
		assert,
	}) => {
		const admin = await adminUser();
		for (const days of ["0", "3651", "abc", "1.5", "-5"]) {
			const page = await client
				.get(`/admin/metrics?days=${days}`)
				.loginAs(admin)
				.withInertia()
				.redirects(0);
			page.assertStatus(200);
			assert.equal((page.inertiaProps as unknown as Props).days, 42, days);
			assert.equal(
				page.body().flash.error,
				"Give days a whole number from 1 to 3650.",
				days,
			);
		}
	});

	test("the window follows days", async ({ client, assert }) => {
		const page = await client
			.get("/admin/metrics?days=7")
			.loginAs(await adminUser())
			.withInertia();
		assert.equal((page.inertiaProps as unknown as Props).days, 7);
	});

	test("a studio owner gets a 404", async ({ client }) => {
		const { a } = await twoStudios();
		(await client.get("/admin/metrics").loginAs(a.owner)).assertStatus(404);
	});
});
