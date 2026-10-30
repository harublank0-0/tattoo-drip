import { randomUUID } from "node:crypto";
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import ArtistService from "#modules/artists/services/artist_service";
import { InquiryRuleError } from "#modules/inquiries/errors";
import Inquiry from "#modules/inquiries/models/inquiry";
import ReferenceImage from "#modules/inquiries/models/reference_image";
import InquiryService, {
	INQUIRIES_PER_PAGE,
} from "#modules/inquiries/services/inquiry_service";
import ImageService from "#modules/media/services/image_service";
import { NO_VIA } from "#modules/notifications/messages";
import DepositService from "#modules/payments/services/deposit_service";
import TattooProject from "#modules/projects/models/tattoo_project";
import ProjectService from "#modules/projects/services/project_service";
import QuoteService from "#modules/projects/services/quote_service";
import SessionService from "#modules/scheduling/services/session_service";
import { addFlashDesign } from "#tests/helpers/artists";
import {
	makeArtist,
	makeClient,
	makeInquiry,
	makeProject,
	makeReferenceImage,
} from "#tests/helpers/pipeline";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

const artists = new ArtistService(new ImageService());
const quotes = new QuoteService();
const deposits = new DepositService(quotes);
const projects = new ProjectService(
	artists,
	quotes,
	deposits,
	new SessionService(artists, deposits),
);
const inquiries = new InquiryService(artists, projects);

type TenantRef = { id: string };

const ideasOf = (list: { idea: string }[]) => list.map(({ idea }) => idea);

async function inquiryIn(
	tenant: TenantRef,
	over: Parameters<typeof makeInquiry>[2] = {},
) {
	return makeInquiry(tenant, await makeClient(tenant), over);
}

test.group("InquiryService reads", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("listNew lists live new inquiries, oldest first, and countNew counts them", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			await inquiryIn(tenant, { idea: "first" });
			await inquiryIn(tenant, { idea: "second" });
			await inquiryIn(tenant, {
				idea: "accepted",
				status: "accepted",
				decidedAt: DateTime.utc(),
			});
			const gone = await inquiryIn(tenant, { idea: "deleted" });
			await gone.softDelete();

			const page = await inquiries.listNew(tenant, 1);
			assert.deepEqual(ideasOf(page.inquiries), ["first", "second"]);
			assert.equal(page.total, 2);
			assert.equal(await inquiries.countNew(tenant), 2);
		});
	});

	test("listNew pages by 25", async ({ assert }) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const client = await makeClient(tenant);
			for (let i = 0; i < INQUIRIES_PER_PAGE + 1; i++) {
				await makeInquiry(tenant, client);
			}
			const first = await inquiries.listNew(tenant, 1);
			assert.lengthOf(first.inquiries, INQUIRIES_PER_PAGE);
			assert.equal(first.lastPage, 2);
			assert.lengthOf((await inquiries.listNew(tenant, 2)).inquiries, 1);
		});
	});

	test("listDecided lists accepted and declined, newest decision first", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			await inquiryIn(tenant, { idea: "still new" });
			await inquiryIn(tenant, {
				idea: "accepted earlier",
				status: "accepted",
				decidedAt: DateTime.utc().minus({ days: 2 }),
			});
			await inquiryIn(tenant, {
				idea: "declined later",
				status: "declined",
				decidedAt: DateTime.utc().minus({ days: 1 }),
			});

			const page = await inquiries.listDecided(tenant, 1);
			assert.deepEqual(ideasOf(page.inquiries), [
				"declined later",
				"accepted earlier",
			]);
		});
	});

	test("findFor finds the tenant's live inquiry; find returns null otherwise", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const inquiry = await inquiryIn(tenant);
			const gone = await inquiryIn(tenant);
			await gone.softDelete();

			assert.equal(
				(await inquiries.findFor(tenant, inquiry.id)).id,
				inquiry.id,
			);
			for (const id of [gone.id, randomUUID()]) {
				await assert.rejects(
					() => inquiries.findFor(tenant, id),
					/Row not found/,
				);
				assert.isNull(await inquiries.find(tenant, id));
			}
		});
	});

	test("findMany gives the tenant's live inquiries among the ids, nothing for the rest (TAT-102)", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("many-a-102", "Many A");
		const { tenant: other } = await studioWithOwner("many-b-102", "Many B");
		const theirs = await inTenant(other, () => inquiryIn(other));

		await inTenant(tenant, async () => {
			const first = await inquiryIn(tenant, { idea: "first" });
			const second = await inquiryIn(tenant, { idea: "second" });
			await inquiryIn(tenant, { idea: "not asked for" });
			const gone = await inquiryIn(tenant, { idea: "deleted" });
			await gone.softDelete();

			const found = await inquiries.findMany(tenant, [
				first.id,
				second.id,
				gone.id,
				theirs.id,
				randomUUID(),
			]);

			assert.deepEqual(ideasOf(found).sort(), ["first", "second"]);
			assert.deepEqual(await inquiries.findMany(tenant, []), []);

			// Only what the Alerts list reads: never the phone or the email.
			const [row] = await inquiries.findMany(tenant, [first.id]);
			assert.equal(row.contactName, first.contactName);
			assert.equal(row.preferredArtistId, null);
			const loaded: Partial<Inquiry> = row;
			assert.isString(first.contactPhone);
			assert.isUndefined(loaded.contactPhone);
			assert.isUndefined(loaded.contactEmail);
		});
	});

	test("images by inquiry or by project, in order; imageCounts per inquiry", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const client = await makeClient(tenant);
			const inquiry = await makeInquiry(tenant, client);
			const other = await makeInquiry(tenant, client);
			const project = await makeProject(tenant, client);
			const second = await makeReferenceImage(tenant, {
				inquiryId: inquiry.id,
				position: 1,
			});
			const first = await makeReferenceImage(tenant, {
				inquiryId: inquiry.id,
				position: 0,
			});
			const gone = await makeReferenceImage(tenant, {
				inquiryId: inquiry.id,
				position: 2,
			});
			await gone.softDelete();
			const onProject = await makeReferenceImage(tenant, {
				projectId: project.id,
			});

			assert.deepEqual(
				(await inquiries.images(tenant, { inquiryId: inquiry.id })).map(
					({ id }) => id,
				),
				[first.id, second.id],
			);
			assert.deepEqual(
				(await inquiries.images(tenant, { projectId: project.id })).map(
					({ id }) => id,
				),
				[onProject.id],
			);
			const counts = await inquiries.imageCounts(tenant, [
				inquiry.id,
				other.id,
			]);
			assert.equal(counts.get(inquiry.id), 2);
			assert.isUndefined(counts.get(other.id));
			assert.equal((await inquiries.imageCounts(tenant, [])).size, 0);
		});
	});

	test("another tenant sees none of it", async ({ assert }) => {
		const { tenant: a } = await studioWithOwner("studio-a", "Studio A");
		const { tenant: b } = await studioWithOwner("studio-b", "Studio B");
		const inquiry = await inTenant(a, () => inquiryIn(a));

		await inTenant(b, async () => {
			assert.lengthOf((await inquiries.listNew(b, 1)).inquiries, 0);
			assert.equal(await inquiries.countNew(b), 0);
			assert.isNull(await inquiries.find(b, inquiry.id));
		});
	});
});

/** The InquiryRuleError reason `work` throws, or null if it succeeds. */
async function reasonOf(work: () => Promise<unknown>) {
	try {
		await work();
		return null;
	} catch (error) {
		if (error instanceof InquiryRuleError) return error.reason;
		throw error;
	}
}

test.group("InquiryService accept and decline", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("accepting creates the project, moves the live images and decides", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const artist = await makeArtist(tenant);
			const inquiry = await inquiryIn(tenant, { idea: "A koi on the calf" });
			const other = await inquiryIn(tenant);
			const kept = await makeReferenceImage(tenant, { inquiryId: inquiry.id });
			const gone = await makeReferenceImage(tenant, {
				inquiryId: inquiry.id,
				position: 1,
			});
			await gone.softDelete();
			const theirs = await makeReferenceImage(tenant, { inquiryId: other.id });

			const project = await inquiries.accept(tenant, inquiry, artist.id);

			const created = await TattooProject.findOrFail(project.id);
			assert.deepEqual(
				[
					created.status,
					created.clientId,
					created.inquiryId,
					created.brief,
					created.artistId,
				],
				[
					"reviewing",
					inquiry.clientId,
					inquiry.id,
					"A koi on the calf",
					artist.id,
				],
			);
			const decided = await Inquiry.findOrFail(inquiry.id);
			assert.equal(decided.status, "accepted");
			assert.isNotNull(decided.decidedAt);
			const moved = await ReferenceImage.findOrFail(kept.id);
			assert.equal(moved.projectId, project.id);
			assert.equal(moved.inquiryId, inquiry.id);
			const stillGone = await ReferenceImage.withTrashed()
				.where("id", gone.id)
				.firstOrFail();
			assert.isNull(stillGone.projectId);
			assert.isNull((await ReferenceImage.findOrFail(theirs.id)).projectId);
		});
	});

	test("accepting a flash request carries the design to the project", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const artist = await makeArtist(tenant);
			const design = await addFlashDesign(tenant, artist);
			const flash = await inquiryIn(tenant, { flashDesignId: design.id });
			const custom = await inquiryIn(tenant);

			const fromFlash = await inquiries.accept(tenant, flash, artist.id);
			const fromCustom = await inquiries.accept(tenant, custom, artist.id);

			assert.equal(
				(await TattooProject.findOrFail(fromFlash.id)).flashDesignId,
				design.id,
			);
			assert.isNull(
				(await TattooProject.findOrFail(fromCustom.id)).flashDesignId,
			);
		});
	});

	test("accepting with no artist leaves the project unassigned", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const project = await inquiries.accept(
				tenant,
				await inquiryIn(tenant),
				null,
			);
			assert.isNull((await TattooProject.findOrFail(project.id)).artistId);
		});
	});

	test("a deleted or another tenant's artist is refused and nothing changes", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("studio-a", "Studio A");
		const { tenant: other } = await studioWithOwner("studio-b", "Studio B");
		const theirs = await inTenant(other, () => makeArtist(other, "theirs"));

		await inTenant(tenant, async () => {
			const gone = await makeArtist(tenant, "gone");
			await gone.softDelete();
			const inquiry = await inquiryIn(tenant);

			for (const artistId of [gone.id, theirs.id, randomUUID()]) {
				assert.equal(
					await reasonOf(() => inquiries.accept(tenant, inquiry, artistId)),
					"artist_unavailable",
				);
			}
			assert.equal((await Inquiry.findOrFail(inquiry.id)).status, "new");
			assert.lengthOf(
				await TattooProject.query().where("inquiry_id", inquiry.id),
				0,
			);
		});
	});

	test("an inquiry is decided once: accepting or declining again is refused", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const accepted = await inquiryIn(tenant);
			await inquiries.accept(tenant, accepted, null);
			assert.equal(
				await reasonOf(() => inquiries.accept(tenant, accepted, null)),
				"already_decided",
			);
			assert.equal(
				await reasonOf(() => inquiries.decline(tenant, accepted)),
				"already_decided",
			);
			assert.lengthOf(
				await TattooProject.query().where("inquiry_id", accepted.id),
				1,
			);
		});
	});

	test("declining decides the inquiry and creates nothing", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const inquiry = await inquiryIn(tenant);
			await inquiries.decline(tenant, inquiry);

			const decided = await Inquiry.findOrFail(inquiry.id);
			assert.equal(decided.status, "declined");
			assert.isNotNull(decided.decidedAt);
			assert.equal(
				await reasonOf(() => inquiries.accept(tenant, inquiry, null)),
				"already_decided",
			);
			assert.lengthOf(
				await TattooProject.query().where("inquiry_id", inquiry.id),
				0,
			);
		});
	});

	test("projectIdsForInquiries maps accepted inquiries to their projects", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("studio-a", "Studio A");
		const { tenant: b } = await studioWithOwner("studio-b", "Studio B");

		const { inquiry, project } = await inTenant(tenant, async () => {
			const inquiry = await inquiryIn(tenant);
			return {
				inquiry,
				project: await inquiries.accept(tenant, inquiry, null),
			};
		});

		await inTenant(tenant, async () => {
			const map = await projects.projectIdsForInquiries(tenant, [inquiry.id]);
			assert.equal(map.get(inquiry.id), project.id);
			assert.equal((await projects.projectIdsForInquiries(tenant, [])).size, 0);
		});
		await inTenant(b, async () => {
			assert.equal(
				(await projects.projectIdsForInquiries(b, [inquiry.id])).size,
				0,
			);
		});
	});
});

test.group("InquiryService contact (TAT-52)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("markContacted records the contact on the inquiry; a deleted one is a 404", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const inquiry = await inquiryIn(tenant);
			await inquiries.markContacted(tenant, inquiry, {
				channel: "viber",
				kind: "inquiry_received",
			});
			const live = await Inquiry.findOrFail(inquiry.id);
			assert.isNotNull(live.lastContactedAt);
			assert.equal(live.lastContactChannel, "viber");
			assert.equal(live.lastContactKind, "inquiry_received");
			assert.equal(live.idea, inquiry.idea);

			const gone = await inquiryIn(tenant);
			await gone.softDelete();
			await assert.rejects(
				() => inquiries.markContacted(tenant, gone, NO_VIA),
				/Row not found/,
			);
		});
	});

	test("accepting carries the inquiry's last contact to its project", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const inquiry = await inquiryIn(tenant);
			await inquiries.markContacted(tenant, inquiry, {
				channel: "whatsapp",
				kind: "inquiry_received",
			});
			const contacted = await Inquiry.findOrFail(inquiry.id);

			const project = await inquiries.accept(tenant, contacted, null);

			const created = await TattooProject.findOrFail(project.id);
			assert.equal(
				created.lastContactedAt?.toMillis(),
				contacted.lastContactedAt?.toMillis(),
			);
			assert.equal(created.lastContactChannel, "whatsapp");
			assert.equal(created.lastContactKind, "inquiry_received");
		});
	});
});
