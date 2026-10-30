import { randomBytes } from "node:crypto";
import queue from "@adonisjs/queue/services/main";
import { test } from "@japa/runner";
import ArtistService, {
	type ProfileEditor,
} from "#modules/artists/services/artist_service";
import ClientService from "#modules/clients/services/client_service";
import { FlashInUseError } from "#modules/flash/errors";
import FlashDesign from "#modules/flash/models/flash_design";
import FlashService from "#modules/flash/services/flash_service";
import { InquiryRuleError } from "#modules/inquiries/errors";
import Inquiry from "#modules/inquiries/models/inquiry";
import IntakeService, {
	type Submission,
} from "#modules/inquiries/services/intake_service";
import { addArtist, addFlashDesign } from "#tests/helpers/artists";
import {
	RecordingImageService,
	testImages,
	uploadOf,
} from "#tests/helpers/images";
import { nextPhone } from "#tests/helpers/pipeline";
import {
	deferred,
	errorOf,
	forgetStudio,
	heldOpen,
	onItsOwnConnection,
	settle,
	waitUntilBlocked,
} from "#tests/helpers/races";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";
import { storedImages } from "#tests/helpers/uploads";

/**
 * Real concurrency (TAT-129 fix round 1): a request for a flash design and
 * the owner removing that design, on two connections. The studios are
 * committed and removed again in the group's teardown.
 */

/** The request's picture processing, held where a real decode would take its time. */
class HeldImages extends RecordingImageService {
	readonly reached = deferred();
	readonly release = deferred();

	override async store(...args: Parameters<RecordingImageService["store"]>) {
		this.reached.resolve();
		await this.release.promise;
		return super.store(...args);
	}
}

function servicesWith(images: RecordingImageService) {
	const artists = new ArtistService(images);
	const flash = new FlashService(images, artists);
	return {
		flash,
		intake: new IntakeService(artists, new ClientService(), images, flash),
	};
}

const submission = (flashDesignId: string, over: Partial<Submission> = {}) => ({
	idea: "The moth, small, on the wrist",
	placement: "Left wrist",
	approximateSize: "About 3 in",
	preferredDates: "Any weekday in November",
	sourceChannel: "other" as const,
	contactName: "Maya Gurung",
	contactPhone: nextPhone(),
	contactEmail: null,
	flashDesignId,
	...over,
});

const slugs: string[] = [];

/** A committed studio with one artist and one shown design nobody has asked for. */
async function studioWithDesign() {
	const slug = `flash-race-${randomBytes(4).toString("hex")}`;
	slugs.push(slug);
	const { owner, tenant } = await studioWithOwner(slug, "Flash race");
	const artist = await addArtist(tenant, owner);
	const design = await inTenant(tenant, () => addFlashDesign(tenant, artist));
	const editor: ProfileEditor = { userId: owner.id, role: "owner" };
	return { tenant, design, editor };
}

const inquiriesOf = (tenant: { id: string }) =>
	inTenant(tenant, () => Inquiry.query().where("tenant_id", tenant.id));

const designsOf = (tenant: { id: string }) =>
	inTenant(tenant, () => FlashDesign.query().where("tenant_id", tenant.id));

test.group("A flash request and the design's removal (TAT-129)", (group) => {
	group.each.setup(() => {
		// The alert job would be committed to the shared queue table.
		queue.fake();
	});
	group.each.teardown(async () => {
		queue.restore();
		for (const slug of slugs.splice(0)) await forgetStudio(slug);
	});

	test("a design removed while the request's pictures are processed: unavailable, not a database error", async ({
		assert,
	}) => {
		const { tenant, design, editor } = await studioWithDesign();
		const held = new HeldImages();
		const { intake } = servicesWith(held);
		const { flash } = servicesWith(new RecordingImageService());
		const requesting = settle(
			inTenant(tenant, async () =>
				intake.submit(
					tenant,
					submission(design.id, {
						referenceImages: [await uploadOf(await testImages.png())],
					}),
				),
			),
		);
		// The request has passed its lookup and now decodes its picture.
		await held.reached.promise;

		// Nothing references the design yet, so the owner removes it for good.
		await inTenant(tenant, () => flash.remove(tenant, editor, design));
		held.release.resolve();
		const outcome = await requesting;

		const refusal = errorOf(outcome);
		assert.instanceOf(refusal, InquiryRuleError, String(refusal));
		assert.equal((refusal as InquiryRuleError).reason, "flash_unavailable");
		assert.lengthOf(await inquiriesOf(tenant), 0);
		assert.lengthOf(await designsOf(tenant), 0);
		assert.deepEqual(
			await storedImages(tenant, "reference_image", "private"),
			[],
			"the refused request's picture is deleted",
		);
	}).timeout(20000);

	test("a removal that has not committed yet: the request waits for it, then finds the design gone", async ({
		assert,
	}) => {
		const { tenant, design, editor } = await studioWithDesign();
		const { intake } = servicesWith(new RecordingImageService());
		const { flash } = servicesWith(new RecordingImageService());
		const removing = heldOpen(tenant, () =>
			flash.remove(tenant, editor, design),
		);
		await removing.reached;

		const requesting = await onItsOwnConnection(tenant, () =>
			intake.submit(tenant, submission(design.id)),
		);
		const waited = await waitUntilBlocked(requesting.pid, requesting.outcome);
		removing.release();
		const [removed, outcome] = await Promise.all([
			removing.outcome,
			requesting.outcome,
		]);

		assert.isTrue(waited, "the request waited for the removal's locks");
		assert.isUndefined(errorOf(removed));
		const refusal = errorOf(outcome);
		assert.instanceOf(refusal, InquiryRuleError, String(refusal));
		assert.equal((refusal as InquiryRuleError).reason, "flash_unavailable");
		assert.lengthOf(await inquiriesOf(tenant), 0);
		assert.lengthOf(await designsOf(tenant), 0);
	}).timeout(20000);

	test("a request that has not committed yet: the removal waits for it, then keeps the design it names", async ({
		assert,
	}) => {
		const { tenant, design, editor } = await studioWithDesign();
		const { intake } = servicesWith(new RecordingImageService());
		const { flash } = servicesWith(new RecordingImageService());
		const requesting = heldOpen(tenant, () =>
			intake.submit(tenant, submission(design.id)),
		);
		await requesting.reached;

		const removing = await onItsOwnConnection(tenant, () =>
			flash.remove(tenant, editor, design),
		);
		const waited = await waitUntilBlocked(removing.pid, removing.outcome);
		requesting.release();
		const [submitted, removed] = await Promise.all([
			requesting.outcome,
			removing.outcome,
		]);

		assert.isTrue(waited, "the removal waited for the request's locks");
		assert.isUndefined(errorOf(submitted), String(errorOf(submitted)));
		assert.instanceOf(errorOf(removed), FlashInUseError);
		const [inquiry] = await inquiriesOf(tenant);
		assert.equal(inquiry.flashDesignId, design.id);
		assert.lengthOf(await designsOf(tenant), 1);
	}).timeout(20000);
});
