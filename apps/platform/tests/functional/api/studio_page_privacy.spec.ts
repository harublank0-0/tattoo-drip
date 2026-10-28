import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import ArtistService from "#modules/artists/services/artist_service";
import ImageService from "#modules/media/services/image_service";
import PaymentMethodService from "#modules/payments/services/payment_method_service";
import TenancyService from "#modules/tenancy/services/tenancy_service";
import { addArtist, addWorkPhoto } from "#tests/helpers/artists";
import { seedPipeline } from "#tests/helpers/pipeline";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";

test.group("Studio page reads: nothing private", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("getStudio, listArtists and getArtist name nothing but the studio page", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner(
			"api-private-44",
			"Private Needle",
		);
		const member = await artistIn(tenant, "member@api-private-44.example");
		await inTenant(tenant, () =>
			new TenancyService().updateDepositSettings(tenant, {
				defaultDepositPercent: 37,
				depositPolicy: "canary-policy-44",
			}),
		);
		const method = await inTenant(tenant, () =>
			new PaymentMethodService(new ImageService()).create(tenant, {
				kind: "esewa",
				label: "canary-method-44",
				accountName: "canary-holder-44",
				accountNumber: "9800000044",
				showOnDepositPage: true,
			}),
		);
		// Linked to the owner: the link must not show.
		const shown = await addArtist(tenant, owner, {
			name: "Shown Artist",
			slug: "shown",
			linkToMe: true,
		});
		const hidden = await addArtist(tenant, owner, {
			name: "canary-hidden-44",
			slug: "canary-hidden",
			visible: false,
		});
		const gone = await addArtist(tenant, owner, {
			name: "canary-deleted-44",
			slug: "canary-deleted",
		});
		await inTenant(tenant, () =>
			new ArtistService(new ImageService()).delete(tenant, gone),
		);
		const pipeline = await inTenant(tenant, () => seedPipeline(tenant));
		// Work photos (TAT-116): the shown artist's are public, a hidden and a
		// deleted artist's are not, and another studio's never are.
		await inTenant(tenant, async () => {
			await addWorkPhoto(tenant, shown, { alt: "shown-photo-44" });
			await addWorkPhoto(tenant, hidden, {
				alt: "canary-hidden-photo-44",
				key: `tenants/${tenant.id}/artist_work_photo/canary-hidden-photo-key-44.jpg`,
			});
			await addWorkPhoto(tenant, gone, {
				alt: "canary-deleted-photo-44",
				key: `tenants/${tenant.id}/artist_work_photo/canary-deleted-photo-key-44.jpg`,
			});
		});
		const other = await studioWithOwner("api-private-other-44", "Other Needle");
		const otherArtist = await addArtist(other.tenant, other.owner);
		await inTenant(other.tenant, () =>
			addWorkPhoto(other.tenant, otherArtist, { alt: "canary-other-photo-44" }),
		);

		const canaries = [
			// Only inside a work photo's URL path, which the check below strips.
			tenant.id,
			owner.id,
			owner.email,
			member.id,
			member.email,
			"canary-policy-44",
			method.id,
			"canary-method-44",
			"canary-holder-44",
			"9800000044",
			hidden.id,
			"canary-hidden",
			gone.id,
			"canary-deleted",
			pipeline.client.id,
			pipeline.client.name,
			pipeline.client.phone ?? "",
			pipeline.inquiry.id,
			pipeline.inquiry.idea,
			pipeline.project.id,
			pipeline.project.brief,
			pipeline.quote.id,
			pipeline.payment.id,
			pipeline.referenceImage.id,
			pipeline.referenceImage.imageKey,
			"canary-hidden-photo-44",
			"canary-hidden-photo-key-44",
			"canary-deleted-photo-44",
			"canary-deleted-photo-key-44",
			"canary-other-photo-44",
			other.tenant.id,
			otherArtist.id,
		].filter((canary) => canary !== "");

		for (const path of ["", "/artists", "/artists/shown"]) {
			const response = await client.get(
				`/api/v1/tenants/api-private-44${path}`,
			);
			response.assertStatus(200);
			// The tenant id may appear in one place only: inside the path of a
			// public work photo's URL (and its copies').
			const text = JSON.stringify(response.body()).replaceAll(
				`/uploads/tenants/${tenant.id}/artist_work_photo/`,
				"/uploads/PHOTO/",
			);
			// Positive control: the answer is this studio's page.
			assert.include(text, path === "" ? "Private Needle" : shown.id);
			if (path !== "") assert.include(text, "shown-photo-44");
			for (const canary of canaries) {
				assert.notInclude(text, canary, `${path || "/"} names ${canary}`);
			}
		}
	});
});
