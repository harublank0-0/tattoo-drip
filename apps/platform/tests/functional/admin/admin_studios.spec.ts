import app from "@adonisjs/core/services/app";
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import { LIVE_ITEMS } from "#controllers/admin_studios_controller";
import PublicationService from "#modules/discovery/services/publication_service";
import ClientReview from "#modules/reviews/models/client_review";
import Tenant from "#modules/tenancy/models/tenant";
import TenancyService from "#modules/tenancy/services/tenancy_service";
import { adminUser } from "#tests/helpers/admin";
import { makeProject } from "#tests/helpers/pipeline";
import { seedReview } from "#tests/helpers/reviews";
import { inTenant, type Studio, twoStudios } from "#tests/helpers/tenants";

function report(studio: Studio) {
	return inTenant(studio.tenant, () =>
		ClientReview.withTrashed()
			.where("id", studio.clientReview.id)
			.update({ reported_at: new Date(), report_reason: "hate" }),
	);
}

test.group("Admin studios", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a studio owner gets a 404 on both pages, the admin a 200", async ({
		client,
	}) => {
		const { a } = await twoStudios();
		const admin = await adminUser();
		for (const url of ["/admin/studios", `/admin/studios/${a.tenant.slug}`]) {
			(await client.get(url).loginAs(a.owner)).assertStatus(404);
			(await client.get(url).loginAs(admin)).assertStatus(200);
		}
	});

	test("the list names each studio with its open reports, oldest first", async ({
		client,
		assert,
	}) => {
		const { a, b } = await twoStudios();
		await report(a);
		const page = await client
			.get("/admin/studios")
			.loginAs(await adminUser())
			.withInertia();
		const studios = page.inertiaProps.studios as {
			slug: string;
			name: string;
			openReports: number;
		}[];
		const slugs = studios.map((studio) => studio.slug);
		assert.isBelow(slugs.indexOf(a.tenant.slug), slugs.indexOf(b.tenant.slug));
		const rowA = studios.find((studio) => studio.slug === a.tenant.slug);
		const rowB = studios.find((studio) => studio.slug === b.tenant.slug);
		assert.equal(rowA?.name, a.tenant.name);
		assert.equal(rowA?.openReports, 1);
		assert.equal(rowB?.openReports, 0);
	});

	test("a studio's page shows its own Discover state, photos, reviews and reports only", async ({
		client,
		assert,
	}) => {
		const { a, b } = await twoStudios();
		await report(a);
		const page = await client
			.get(`/admin/studios/${a.tenant.slug}`)
			.loginAs(await adminUser())
			.withInertia();
		const props = page.inertiaProps as any;
		const publication = await app.container.make(PublicationService);
		const status = await publication.operatorStatus(a.tenant.slug);
		assert.equal(props.discover.status, status.status);
		const photo = props.photos.find(
			(item: { id: string }) => item.id === a.workPhoto.id,
		);
		assert.isString(photo?.thumbnailUrl);
		assert.include(
			props.live.map((item: { id: string }) => item.id),
			a.clientReview.id,
		);
		assert.lengthOf(props.reports, 1);
		assert.equal(props.reports[0].reviewId, a.clientReview.id);
		assert.isArray(props.takedownReasons);
		const text = JSON.stringify(props);
		for (const id of [b.workPhoto.id, b.clientReview.id, b.tenant.id]) {
			assert.notInclude(text, id);
		}
	});

	test("an old slug redirects to the current one", async ({ client }) => {
		const { a } = await twoStudios();
		const old = a.tenant.slug;
		await inTenant(a.tenant, () =>
			new TenancyService().changeSlug(a.tenant, "studio-a-new"),
		);
		const response = await client
			.get(`/admin/studios/${old}`)
			.loginAs(await adminUser())
			.redirects(0);
		response.assertStatus(302);
		response.assertHeader("location", "/admin/studios/studio-a-new");
	});

	test("an unknown or deleted studio's slug is a 404", async ({ client }) => {
		const { a } = await twoStudios();
		const admin = await adminUser();
		(
			await client.get("/admin/studios/no-such-studio").loginAs(admin)
		).assertStatus(404);
		await inTenant(a.tenant, async () =>
			(await Tenant.findOrFail(a.tenant.id)).softDelete(),
		);
		(
			await client.get(`/admin/studios/${a.tenant.slug}`).loginAs(admin)
		).assertStatus(404);
	});

	async function addReviews(studio: Studio, count: number) {
		await inTenant(studio.tenant, async () => {
			for (let i = 0; i < count; i++) {
				const project = await makeProject(
					studio.tenant,
					studio.pipeline.client,
					{
						status: "completed",
						artistId: studio.artistProfile.id,
					},
				);
				await seedReview(studio.tenant, project, {
					createdAt: DateTime.now().minus({ minutes: i }),
				});
			}
		});
	}

	test("Show more appears only when more live items exist than are listed", async ({
		client,
		assert,
	}) => {
		const { a, b } = await twoStudios();
		const admin = await adminUser();
		const live = async (slug: string, query = "") =>
			(
				await client
					.get(`/admin/studios/${slug}${query}`)
					.loginAs(admin)
					.withInertia()
			).inertiaProps as { live: unknown[]; hasMore: boolean };

		const before = (await live(a.tenant.slug)).live.length;
		assert.isBelow(before, 20);
		assert.isFalse((await live(a.tenant.slug)).hasMore);

		await addReviews(a, 22);
		const first = await live(a.tenant.slug);
		assert.lengthOf(first.live, 20);
		assert.isTrue(first.hasMore);
		const all = await live(a.tenant.slug, "?more=1");
		assert.lengthOf(all.live, before + 22);
		assert.isFalse(all.hasMore);

		assert.isFalse((await live(b.tenant.slug)).hasMore);
	});

	test("a studio with exactly the default limit of live items gets no Show more", async ({
		client,
		assert,
	}) => {
		const { a } = await twoStudios();
		const admin = await adminUser();
		const url = `/admin/studios/${a.tenant.slug}`;
		const props = async () =>
			(await client.get(url).loginAs(admin).withInertia()).inertiaProps as {
				live: unknown[];
				hasMore: boolean;
			};
		const before = (await props()).live.length;
		await addReviews(a, LIVE_ITEMS - before);
		const page = await props();
		assert.lengthOf(page.live, LIVE_ITEMS);
		assert.isFalse(page.hasMore);
	});
});
