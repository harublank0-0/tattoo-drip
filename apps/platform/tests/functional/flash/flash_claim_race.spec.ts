import { randomBytes } from "node:crypto";
import queue from "@adonisjs/queue/services/main";
import { test } from "@japa/runner";
import ArtistService from "#modules/artists/services/artist_service";
import ClientService from "#modules/clients/services/client_service";
import { FlashInUseError } from "#modules/flash/errors";
import FlashDesign from "#modules/flash/models/flash_design";
import { claimFlashFor } from "#modules/flash/services/flash_claim";
import FlashService from "#modules/flash/services/flash_service";
import { InquiryRuleError } from "#modules/inquiries/errors";
import Inquiry from "#modules/inquiries/models/inquiry";
import IntakeService from "#modules/inquiries/services/intake_service";
import TattooProject from "#modules/projects/models/tattoo_project";
import { addArtist, addFlashDesign } from "#tests/helpers/artists";
import { RecordingImageService } from "#tests/helpers/images";
import { makeClient, makeProject, nextPhone } from "#tests/helpers/pipeline";
import {
	deferred,
	errorOf,
	forgetStudio,
	heldOpen,
	onItsOwnConnection,
	waitUntilBlocked,
} from "#tests/helpers/races";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

/**
 * Real concurrency (TAT-129 part 4b): the claim (a verified deposit or a
 * booking, under the project's row lock) and what the studio does to the same
 * design (hide it, remove it, mark it by hand) on two connections. The lock
 * orders are: a claim, the project and then the design; the studio's writes,
 * the artist and then the design. They share only the design's row, so
 * nothing the studio does may take the design's row and then wait for a
 * project, or the two would wait for each other. The studios are committed
 * and removed again in the group's teardown.
 */

const slugs: string[] = [];

/** A committed studio, one one-of-a-kind design and a deposit_pending project made from it. */
async function studioWithProject() {
	const slug = `flash-claim-${randomBytes(4).toString("hex")}`;
	slugs.push(slug);
	const { owner, tenant } = await studioWithOwner(slug, "Flash claim");
	const artist = await addArtist(tenant, owner);
	const design = await inTenant(tenant, () =>
		addFlashDesign(tenant, artist, { oneOfAKind: true }),
	);
	const project = await inTenant(tenant, async () =>
		makeProject(tenant, await makeClient(tenant), {
			status: "deposit_pending",
			flashDesignId: design.id,
		}),
	);
	const images = new RecordingImageService();
	const artists = new ArtistService(images);
	const flash = new FlashService(images, artists);
	const intake = new IntakeService(artists, new ClientService(), images, flash);
	const editor = { userId: owner.id, role: "owner" as const };
	return { tenant, design, project, flash, intake, editor };
}

/** The claim as the verifying transaction makes it: the project's row first, then the claim. */
function claiming(
	tenant: { id: string },
	project: { id: string },
	startClaim = deferred(),
) {
	const locked = deferred();
	const held = heldOpen(tenant, async () => {
		const live = await TattooProject.query()
			.where("id", project.id)
			.forUpdate()
			.firstOrFail();
		locked.resolve();
		await startClaim.promise;
		return claimFlashFor(tenant, live);
	});
	return { ...held, locked: locked.promise, startClaim };
}

const designOf = (tenant: { id: string }, id: string) =>
	inTenant(tenant, () => FlashDesign.query().where("id", id).first());

const submission = (flashDesignId: string) => ({
	idea: "The moth, small, on the wrist",
	placement: "Left wrist",
	approximateSize: "About 3 in",
	preferredDates: "Any weekday in November",
	sourceChannel: "other" as const,
	contactName: "Maya Gurung",
	contactPhone: nextPhone(),
	contactEmail: null,
	flashDesignId,
});

const inquiriesOf = (tenant: { id: string }) =>
	inTenant(tenant, () => Inquiry.query().where("tenant_id", tenant.id));

test.group(
	"A claim and the studio's changes to the design (TAT-129)",
	(group) => {
		group.each.setup(() => {
			// The alert job would be committed to the shared queue table.
			queue.fake();
		});
		group.each.teardown(async () => {
			queue.restore();
			for (const slug of slugs.splice(0)) await forgetStudio(slug);
		});

		test("a removal of a design a project names does not wait for the project's lock: the claim lands, the removal is FlashInUseError", async ({
			assert,
		}) => {
			const { tenant, design, project, flash, editor } =
				await studioWithProject();
			const claim = claiming(tenant, project);
			await claim.locked;

			const removing = await onItsOwnConnection(tenant, () =>
				flash.remove(tenant, editor, design),
			);
			const waited = await waitUntilBlocked(removing.pid, removing.outcome);
			claim.startClaim.resolve();
			claim.release();
			const [claimed, removed] = await Promise.all([
				claim.outcome,
				removing.outcome,
			]);

			assert.isFalse(waited, "the removal did not hold the design and wait");
			assert.isUndefined(errorOf(claimed), String(errorOf(claimed)));
			assert.deepEqual(claimed, { value: true });
			assert.instanceOf(errorOf(removed), FlashInUseError);
			const stored = await designOf(tenant, design.id);
			assert.equal(stored?.claimedProjectId, project.id);
		}).timeout(30000);

		test("hiding the design while a claim is in flight waits for it and keeps the claim", async ({
			assert,
		}) => {
			const { tenant, design, project, flash, editor } =
				await studioWithProject();
			const claim = claiming(tenant, project, deferred());
			claim.startClaim.resolve();
			await claim.locked;
			await claim.reached;

			const hiding = await onItsOwnConnection(tenant, () =>
				flash.update(tenant, editor, design, {
					name: "Moth",
					size: "About 3 in",
					price: null,
					oneOfAKind: true,
					hidden: true,
				}),
			);
			const waited = await waitUntilBlocked(hiding.pid, hiding.outcome);
			claim.release();
			const [claimed, hidden] = await Promise.all([
				claim.outcome,
				hiding.outcome,
			]);

			assert.isTrue(waited, "the hide waited for the claim's row lock");
			assert.deepEqual(claimed, { value: true });
			assert.isUndefined(errorOf(hidden), String(errorOf(hidden)));
			const stored = await designOf(tenant, design.id);
			assert.isTrue(stored?.hidden);
			assert.equal(
				stored?.claimedProjectId,
				project.id,
				"the hide kept the claim",
			);
		}).timeout(30000);

		test("switching the design to can be tattooed again while a claim is in flight waits for it, then releases that claim: no check violation", async ({
			assert,
		}) => {
			const { tenant, design, project, flash, editor } =
				await studioWithProject();
			const claim = claiming(tenant, project, deferred());
			claim.startClaim.resolve();
			await claim.locked;
			await claim.reached;

			const editing = await onItsOwnConnection(tenant, () =>
				flash.update(tenant, editor, design, {
					name: "Moth",
					size: "About 3 in",
					price: null,
					oneOfAKind: false,
					hidden: false,
				}),
			);
			const waited = await waitUntilBlocked(editing.pid, editing.outcome);
			claim.release();
			const [claimed, edited] = await Promise.all([
				claim.outcome,
				editing.outcome,
			]);

			assert.isTrue(waited, "the edit waited for the claim's row lock");
			assert.deepEqual(claimed, { value: true });
			assert.isUndefined(errorOf(edited), String(errorOf(edited)));
			const stored = await designOf(tenant, design.id);
			assert.isFalse(stored?.oneOfAKind);
			assert.isNull(stored?.claimedAt, "the claim was released with it");
			assert.isNull(stored?.claimedProjectId);
		}).timeout(30000);

		test("a claim that comes while the design is being switched to can be tattooed again waits for the edit and claims nothing", async ({
			assert,
		}) => {
			const { tenant, design, project, flash, editor } =
				await studioWithProject();
			const edit = heldOpen(tenant, () =>
				flash.update(tenant, editor, design, {
					name: "Moth",
					size: "About 3 in",
					price: null,
					oneOfAKind: false,
					hidden: false,
				}),
			);
			await edit.reached;

			const claimer = await onItsOwnConnection(tenant, async () => {
				const live = await TattooProject.query()
					.where("id", project.id)
					.forUpdate()
					.firstOrFail();
				return claimFlashFor(tenant, live);
			});
			const waited = await waitUntilBlocked(claimer.pid, claimer.outcome);
			edit.release();
			const [edited, claimed] = await Promise.all([
				edit.outcome,
				claimer.outcome,
			]);

			assert.isTrue(waited, "the claim waited for the edit's row lock");
			assert.isUndefined(errorOf(edited), String(errorOf(edited)));
			assert.deepEqual(claimed, { value: false });
			const stored = await designOf(tenant, design.id);
			assert.isFalse(stored?.oneOfAKind);
			assert.isNull(stored?.claimedAt);
		}).timeout(30000);

		test("marking the design claimed by hand while a project's claim is in flight leaves the project's claim", async ({
			assert,
		}) => {
			const { tenant, design, project, flash, editor } =
				await studioWithProject();
			const claim = claiming(tenant, project, deferred());
			claim.startClaim.resolve();
			await claim.locked;
			await claim.reached;

			const marking = await onItsOwnConnection(tenant, () =>
				flash.setClaimed(tenant, editor, design, true),
			);
			const waited = await waitUntilBlocked(marking.pid, marking.outcome);
			claim.release();
			const [claimed, marked] = await Promise.all([
				claim.outcome,
				marking.outcome,
			]);

			assert.isTrue(waited, "the hand claim waited for the claim's row lock");
			assert.deepEqual(claimed, { value: true });
			assert.isUndefined(errorOf(marked), String(errorOf(marked)));
			const stored = await designOf(tenant, design.id);
			assert.equal(stored?.claimedProjectId, project.id);
		}).timeout(30000);

		test("a claim in flight when a request comes: the request waits for it, then is refused flash_claimed", async ({
			assert,
		}) => {
			const { tenant, design, project, intake } = await studioWithProject();
			const claim = claiming(tenant, project, deferred());
			claim.startClaim.resolve();
			await claim.locked;
			await claim.reached;

			const requesting = await onItsOwnConnection(tenant, () =>
				intake.submit(tenant, submission(design.id)),
			);
			const waited = await waitUntilBlocked(requesting.pid, requesting.outcome);
			claim.release();
			const [claimed, outcome] = await Promise.all([
				claim.outcome,
				requesting.outcome,
			]);

			assert.isTrue(waited, "the request waited for the claim's row lock");
			assert.deepEqual(claimed, { value: true });
			const refusal = errorOf(outcome);
			assert.instanceOf(refusal, InquiryRuleError, String(refusal));
			assert.equal((refusal as InquiryRuleError).reason, "flash_claimed");
			assert.lengthOf(await inquiriesOf(tenant), 0);
		}).timeout(30000);

		test("a request in flight when a claim comes: the claim waits for it, and the request is stored before the claim", async ({
			assert,
		}) => {
			const { tenant, design, project, intake } = await studioWithProject();
			const requesting = heldOpen(tenant, () =>
				intake.submit(tenant, submission(design.id)),
			);
			await requesting.reached;

			const claimer = await onItsOwnConnection(tenant, async () => {
				const live = await TattooProject.query()
					.where("id", project.id)
					.forUpdate()
					.firstOrFail();
				return claimFlashFor(tenant, live);
			});
			const waited = await waitUntilBlocked(claimer.pid, claimer.outcome);
			requesting.release();
			const [submitted, claimed] = await Promise.all([
				requesting.outcome,
				claimer.outcome,
			]);

			assert.isTrue(waited, "the claim waited for the request's hold");
			assert.isUndefined(errorOf(submitted), String(errorOf(submitted)));
			assert.deepEqual(claimed, { value: true });
			const [inquiry] = await inquiriesOf(tenant);
			assert.equal(inquiry.flashDesignId, design.id);
			const stored = await designOf(tenant, design.id);
			assert.equal(stored?.claimedProjectId, project.id);
		}).timeout(30000);
	},
);
