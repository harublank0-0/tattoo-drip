import { randomBytes } from "node:crypto";
import { test } from "@japa/runner";
import ArtistService from "#modules/artists/services/artist_service";
import { FlashInUseError } from "#modules/flash/errors";
import FlashDesign from "#modules/flash/models/flash_design";
import { claimFlashFor } from "#modules/flash/services/flash_claim";
import FlashService from "#modules/flash/services/flash_service";
import TattooProject from "#modules/projects/models/tattoo_project";
import { addArtist, addFlashDesign } from "#tests/helpers/artists";
import { RecordingImageService } from "#tests/helpers/images";
import { makeClient, makeProject } from "#tests/helpers/pipeline";
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
 * order is artist, then design, then project, and the claim holds the project
 * first: so nothing the studio does may take the design's row and then wait
 * for the project, or the two would wait for each other. The studios are
 * committed and removed again in the group's teardown.
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
	const flash = new FlashService(images, new ArtistService(images));
	const editor = { userId: owner.id, role: "owner" as const };
	return { tenant, design, project, flash, editor };
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

test.group(
	"A claim and the studio's changes to the design (TAT-129)",
	(group) => {
		group.each.teardown(async () => {
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
	},
);
