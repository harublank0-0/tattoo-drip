import app from "@adonisjs/core/services/app";
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import { LIVE_ITEMS } from "#controllers/admin_studios_controller";
import { STATUS_WORDS } from "#modules/discovery/publication";
import PublicationService from "#modules/discovery/services/publication_service";
import ClientReview from "#modules/reviews/models/client_review";
import ReviewOperatorService from "#modules/reviews/services/review_operator_service";
import Tenant from "#modules/tenancy/models/tenant";
import TenancyService from "#modules/tenancy/services/tenancy_service";
import { adminUser } from "#tests/helpers/admin";
import { addWorkVideo } from "#tests/helpers/artists";
import { makeProject } from "#tests/helpers/pipeline";
import { seedReview } from "#tests/helpers/reviews";
import { inTenant, type Studio, twoStudios } from "#tests/helpers/tenants";

function report(studio: Studio, reason = "hate") {
	return inTenant(studio.tenant, () =>
		ClientReview.withTrashed()
			.where("id", studio.clientReview.id)
			.update({ reported_at: new Date(), report_reason: reason }),
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
		assert.equal(props.discover.statusLabel, STATUS_WORDS[status.status].label);
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

	for (const state of ["processing", "failed", "ready"] as const) {
		test(`a studio with a ${state} video angle gets its page, with the video and the angle listed`, async ({
			client,
			assert,
		}) => {
			const { a } = await twoStudios();
			const video = await inTenant(a.tenant, () =>
				addWorkVideo(
					a.tenant,
					a.artistProfile,
					// The seeded lead's columns as the database defaults them.
					{ id: a.tattooLead.id, hidden: false, styles: [], healed: false },
					2,
					{ state },
				),
			);
			const page = await client
				.get(`/admin/studios/${a.tenant.slug}`)
				.loginAs(await adminUser())
				.withInertia();
			page.assertStatus(200);
			const photos = page.inertiaProps.photos as {
				id: string;
				kind: string;
				thumbnailUrl: string | null;
				placeholder: string | null;
			}[];
			const angle = photos.find((photo) => photo.id === a.tattooAngle.id);
			assert.equal(angle?.kind, "photo");
			assert.isString(angle?.thumbnailUrl);
			const tile = photos.find((photo) => photo.id === video.id);
			assert.equal(tile?.kind, "video");
			if (state === "ready") {
				assert.include(tile?.thumbnailUrl ?? "", "work_video");
				assert.isNull(tile?.placeholder);
			} else {
				assert.isNull(tile?.thumbnailUrl);
				assert.equal(
					tile?.placeholder,
					state === "processing" ? "Video processing" : "Video failed",
				);
			}
		});
	}

	test("both pages show words for the stored keys: status, type, kind and reasons", async ({
		client,
		assert,
	}) => {
		const { a } = await twoStudios();
		assert.equal(a.tenant.type, "studio");
		const publication = await app.container.make(PublicationService);
		await publication.suspendStudio(a.tenant.slug, "Copyright complaint");
		const operator = await app.container.make(ReviewOperatorService);
		await operator.takedown("reply", a.clientReview.id, "client_request", null);
		await report(a, "off_topic");
		const admin = await adminUser();

		const list = await client
			.get("/admin/studios")
			.loginAs(admin)
			.withInertia();
		const row = (list.inertiaProps.studios as Record<string, unknown>[]).find(
			(studio) => studio.slug === a.tenant.slug,
		);
		assert.equal(row?.typeLabel, "Studio");
		assert.equal(row?.discoverStatusLabel, "Removed by TattooDrip");
		// The status already says it is taken down; no second badge.
		assert.notProperty(row, "takenDown");

		const page = await client
			.get(`/admin/studios/${a.tenant.slug}`)
			.loginAs(admin)
			.withInertia();
		const props = page.inertiaProps as any;
		assert.equal(props.discover.statusLabel, "Removed by TattooDrip");
		assert.equal(props.reports[0].reasonLabel, "Off-topic");
		const reply = props.takenDown.find(
			(item: { kind: string }) => item.kind === "reply",
		);
		assert.equal(reply.kindLabel, "Reply");
		assert.equal(reply.takedown.reasonLabel, "Client's request");
		const kinds = props.live.map(
			(item: { kind: string; kindLabel: string }) => [
				item.kind,
				item.kindLabel,
			],
		);
		assert.deepInclude(kinds, ["review", "Review"]);
		assert.deepInclude(kinds, ["post", "Fresh ink post"]);
		assert.deepEqual(props.takedownReasons, [
			{ value: "hate", label: "Hate" },
			{ value: "threats", label: "Threats" },
			{ value: "personal_data", label: "Personal data" },
			{ value: "off_topic", label: "Off-topic" },
			{ value: "not_a_client", label: "Not a client" },
			{ value: "client_request", label: "Client's request" },
			{ value: "other", label: "Other" },
		]);
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
