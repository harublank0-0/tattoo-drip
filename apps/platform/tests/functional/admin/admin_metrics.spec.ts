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
import TenancyService from "#modules/tenancy/services/tenancy_service";
import { withDbContext } from "#services/db_context";
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
		const tenancy = await app.container.make(TenancyService);
		const window = lastDays(42);
		// Every studio the page lists, the dev database's others included.
		const all = [];
		for (const row of props.studios) {
			const tenantId = await tenancy.tenantIdForSlug(row.slug);
			assert.exists(tenantId, row.slug);
			const facts = await withDbContext({ tenantId: tenantId as string }, () =>
				service.forStudio({ id: tenantId as string }, window),
			);
			all.push(facts);
			assert.deepEqual(row.tiles, pilotTiles(facts), row.slug);
		}
		for (const { tenant } of [a, b]) {
			assert.equal(
				props.studios.find((row) => row.slug === tenant.slug)?.name,
				tenant.name,
			);
		}
		assert.equal(props.total.count, props.studios.length);
		assert.deepEqual(props.total.tiles, pilotTiles(combineFacts(all)));
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
