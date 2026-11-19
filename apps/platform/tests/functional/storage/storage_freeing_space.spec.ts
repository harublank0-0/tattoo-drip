import app from "@adonisjs/core/services/app";
import testUtils from "@adonisjs/core/services/test_utils";
import type { ApiClient } from "@japa/api-client";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import type User from "#models/user";
import DesignAsset from "#modules/design_lab/models/design_asset";
import DesignGeneration from "#modules/design_lab/models/design_generation";
import DesignProject from "#modules/design_lab/models/design_project";
import ReferenceImage from "#modules/inquiries/models/reference_image";
import ImageService from "#modules/media/services/image_service";
import Payment from "#modules/payments/models/payment";
import StorageMeterService from "#modules/storage/services/storage_meter_service";
import type Tenant from "#modules/tenancy/models/tenant";
import { seedDesignLab } from "#tests/helpers/design_lab";
import { testImages } from "#tests/helpers/images";
import {
	makeClient,
	makeInquiry,
	makePayment,
	makeProject,
	makeReferenceImage,
} from "#tests/helpers/pipeline";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";

/**
 * Freeing space (the storage meter, step 2): a member deletes a Design Lab
 * project with its concepts; an owner deletes a client's reference photo
 * or a decided payment's deposit screenshot. Each frees its bytes at once,
 * and each is the same 404 for anyone who may not.
 */
test.group("Storage: freeing space", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	const usageOf = async (tenant: Tenant) =>
		inTenant(tenant, async () =>
			(await app.container.make(StorageMeterService)).usage(tenant),
		);
	const destroy = (client: ApiClient, user: User, url: string) =>
		client.delete(url).loginAs(user).withCsrfToken().redirects(0);

	/** A stored image of `purpose`, as an upload leaves it. */
	const storedImage = (
		tenant: Tenant,
		purpose: "reference_image" | "payment_proof",
	) =>
		inTenant(tenant, async () =>
			new ImageService().storeBytes(await testImages.png(500, 400), {
				tenant,
				purpose,
			}),
		);

	test("deleting a Design Lab project deletes its concepts and frees their bytes", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner("free-lab", "Free Lab");
		const artist = await artistIn(tenant, "artist@free-lab.example");
		const { designProject } = await seedDesignLab(tenant, artist);
		assert.isAbove((await usageOf(tenant)).byCategory.design_lab, 0);

		const response = await destroy(
			client,
			artist,
			`/t/${tenant.slug}/design-lab/${designProject.id}`,
		);

		response.assertStatus(302);
		assert.equal(response.header("location"), `/t/${tenant.slug}/design-lab`);
		assert.equal((await usageOf(tenant)).byCategory.design_lab, 0);
		await inTenant(tenant, async () => {
			assert.isNull(await DesignProject.find(designProject.id));
			assert.lengthOf(
				await DesignAsset.query().where("design_project_id", designProject.id),
				0,
			);
		});
	});

	test("a project with a concept being made isn't deleted, and says why", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner("free-lab-busy", "Free Lab Busy");
		const artist = await artistIn(tenant, "artist@free-lab-busy.example");
		const { designProject, designGeneration } = await seedDesignLab(
			tenant,
			artist,
		);
		await inTenant(tenant, () =>
			DesignGeneration.query()
				.where("id", designGeneration.id)
				.update({ status: "queued", failure_code: null, finished_at: null }),
		);

		const response = await destroy(
			client,
			artist,
			`/t/${tenant.slug}/design-lab/${designProject.id}`,
		);

		response.assertStatus(302);
		assert.equal(
			response.flashMessage("error"),
			"Wait for the concepts being made to finish, then delete the project.",
		);
		await inTenant(tenant, async () => {
			assert.exists(await DesignProject.find(designProject.id));
		});
	});

	test("an artist can't delete another member's design project: 404", async ({
		client,
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner(
			"free-lab-theirs",
			"Free Lab Theirs",
		);
		const { designProject } = await seedDesignLab(tenant, owner);
		const artist = await artistIn(tenant, "artist@free-lab-theirs.example");

		(
			await destroy(
				client,
				artist,
				`/t/${tenant.slug}/design-lab/${designProject.id}`,
			)
		).assertStatus(404);
		await inTenant(tenant, async () => {
			assert.exists(await DesignProject.find(designProject.id));
		});
	});

	test("an owner deletes a client's reference photo; an artist and another studio get a 404", async ({
		client,
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner("free-ref", "Free Ref");
		const artist = await artistIn(tenant, "artist@free-ref.example");
		const other = await studioWithOwner("free-ref-other", "Free Ref Other");
		const image = await storedImage(tenant, "reference_image");
		const reference = await inTenant(tenant, async () => {
			const inquiry = await makeInquiry(tenant, await makeClient(tenant));
			return makeReferenceImage(tenant, {
				inquiryId: inquiry.id,
				imageKey: image.key,
				width: image.width,
				height: image.height,
			});
		});
		const url = `/t/${tenant.slug}/references/${reference.id}`;
		assert.isAbove((await usageOf(tenant)).byCategory.clients, 0);

		(await destroy(client, artist, url)).assertStatus(404);
		(
			await destroy(
				client,
				other.owner,
				`/t/${other.tenant.slug}/references/${reference.id}`,
			)
		).assertStatus(404);
		assert.isAbove((await usageOf(tenant)).byCategory.clients, 0);

		const response = await destroy(client, owner, url);
		response.assertStatus(302);
		assert.equal(response.flashMessage("success"), "Photo deleted.");
		assert.equal((await usageOf(tenant)).byCategory.clients, 0);
		await inTenant(tenant, async () => {
			assert.isNull(await ReferenceImage.find(reference.id));
		});
	});

	test("an owner deletes a decided payment's screenshot, keeping the payment; a waiting one is refused", async ({
		client,
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner("free-proof", "Free Proof");
		const artist = await artistIn(tenant, "artist@free-proof.example");
		const proof = async (status: "submitted" | "verified") => {
			const image = await storedImage(tenant, "payment_proof");
			return inTenant(tenant, async () => {
				const project = await makeProject(tenant, await makeClient(tenant), {
					status: "booked",
				});
				return makePayment(tenant, project, {
					status,
					...(status === "verified"
						? { verifiedAt: DateTime.utc(), verifiedByUserId: owner.id }
						: {}),
					proofImageKey: image.key,
					proofImageWidth: image.width,
					proofImageHeight: image.height,
				});
			});
		};
		const verified = await proof("verified");
		const waiting = await proof("submitted");
		const url = (id: string) => `/t/${tenant.slug}/payments/${id}/proof`;
		const reload = (id: string) =>
			inTenant(tenant, () => Payment.findOrFail(id));

		(await destroy(client, artist, url(verified.id))).assertStatus(404);

		const refused = await destroy(client, owner, url(waiting.id));
		refused.assertStatus(302);
		assert.equal(
			refused.flashMessage("error"),
			"Verify or reject this payment before deleting its screenshot.",
		);
		assert.isNotNull((await reload(waiting.id)).proofImageKey);

		const before = (await usageOf(tenant)).byCategory.clients;
		const response = await destroy(client, owner, url(verified.id));
		response.assertStatus(302);
		assert.equal(response.flashMessage("success"), "Screenshot deleted.");
		const payment = await reload(verified.id);
		assert.equal(payment.status, "verified");
		assert.isNull(payment.proofImageKey);
		assert.isNotNull(payment.proofRemovedAt);
		assert.isBelow((await usageOf(tenant)).byCategory.clients, before);
		// The marker is set once, only with the proof's removal.
		await assert.rejects(
			() =>
				inTenant(tenant, () =>
					Payment.query()
						.where("id", verified.id)
						.update({ proof_removed_at: null }),
				),
			/proof_removed_at is set only when the proof is removed/,
		);
	});
});
