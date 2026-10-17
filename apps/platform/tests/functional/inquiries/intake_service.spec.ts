import { randomUUID } from "node:crypto";
import testUtils from "@adonisjs/core/services/test_utils";
import drive from "@adonisjs/drive/services/main";
import db from "@adonisjs/lucid/services/db";
import queue from "@adonisjs/queue/services/main";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import Artist from "#modules/artists/models/artist";
import ArtistService from "#modules/artists/services/artist_service";
import Client from "#modules/clients/models/client";
import ClientService from "#modules/clients/services/client_service";
import {
	InquiryRuleError,
	InvalidReferenceImageError,
} from "#modules/inquiries/errors";
import NewInquiryAlertJob from "#modules/inquiries/jobs/new_inquiry_alert_job";
import Inquiry from "#modules/inquiries/models/inquiry";
import ReferenceImage from "#modules/inquiries/models/reference_image";
import IntakeService, {
	type Submission,
} from "#modules/inquiries/services/intake_service";
import { IMAGE_FORMAT_MESSAGE } from "#modules/media/errors";
import { withDbContext } from "#services/db_context";
import {
	RecordingImageService,
	testImages,
	uploadOf,
} from "#tests/helpers/images";
import { makeClient, makeInquiry, nextPhone } from "#tests/helpers/pipeline";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

type TenantRef = { id: string };

/** An ImageService whose `failOn`-th store fails with a non-image error (a full disk). */
class FailingImageService extends RecordingImageService {
	stores = 0;

	constructor(private failOn: number) {
		super();
	}

	override async store(...args: Parameters<RecordingImageService["store"]>) {
		this.stores += 1;
		if (this.stores === this.failOn) throw new Error("disk full");
		return super.store(...args);
	}
}

function makeIntake(
	images: RecordingImageService = new RecordingImageService(),
) {
	return {
		images,
		intake: new IntakeService(
			new ArtistService(images),
			new ClientService(),
			images,
		),
	};
}

const submission = (over: Partial<Submission> = {}): Submission => ({
	idea: "A fine-line peony with two leaves",
	placement: "Left forearm",
	approximateSize: "About 10 cm",
	preferredDates: "Any weekday in November",
	sourceChannel: "instagram",
	contactName: "Maya Gurung",
	contactPhone: nextPhone(),
	contactEmail: "maya@example.com",
	...over,
});

const pngs = async (count: number) => {
	const uploads: { tmpPath: string }[] = [];
	for (let i = 0; i < count; i++) {
		uploads.push(await uploadOf(await testImages.png()));
	}
	return uploads;
};

/** The InquiryRuleError reason a refused submit gives, or null if it went through. */
async function reasonOf(work: () => Promise<unknown>) {
	try {
		await work();
		return null;
	} catch (error) {
		if (error instanceof InquiryRuleError) return error.reason;
		throw error;
	}
}

async function rejectionOf(work: () => Promise<unknown>): Promise<unknown> {
	try {
		await work();
	} catch (error) {
		return error;
	}
	throw new Error("expected the submit to fail");
}

/** What the studio holds: its clients, inquiries and reference rows. */
const rowsIn = (tenant: TenantRef) =>
	inTenant(tenant, async () => ({
		clients: await Client.query().orderBy("id"),
		inquiries: await Inquiry.query().orderBy("id"),
		images: await ReferenceImage.query().orderBy("position"),
	}));

const exists = (key: string) => drive.use("private").exists(key);

/**
 * This studio's rows in the queue table, committed or in the test's
 * transaction. Not the whole table: the dev database is shared, and a running
 * worker adds and removes other jobs. A job's `data` holds its payload, so the
 * studio's own (per-test) id finds its jobs.
 */
const queuedJobs = async (tenant: TenantRef) =>
	Number(
		(
			await db
				.from("queue_jobs")
				.where("data", "like", `%${tenant.id}%`)
				.count("* as total")
		)[0].total,
	);

test.group("IntakeService.submit", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.teardown(() => queue.restore());

	test("a new phone: a new client, a `new` inquiry with what was sent, its images in order", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("intake-svc-51");
		const { intake, images } = makeIntake();
		const sent = submission({
			budget: "NPR 15000",
			referenceImages: await pngs(2),
		});

		const inquiry = await inTenant(tenant, () => intake.submit(tenant, sent));

		const rows = await rowsIn(tenant);
		assert.deepEqual(
			rows.clients.map((c) => [c.name, c.phone, c.email, c.notes]),
			[["Maya Gurung", sent.contactPhone, "maya@example.com", null]],
		);
		assert.deepEqual(
			rows.inquiries.map((row) => [
				row.id,
				row.clientId,
				row.status,
				row.idea,
				row.placement,
				row.approximateSize,
				row.preferredDates,
				row.preferredArtistId,
				row.budget,
				row.sourceChannel,
				row.contactName,
				row.contactPhone,
				row.contactEmail,
			]),
			[
				[
					inquiry.id,
					rows.clients[0].id,
					"new",
					sent.idea,
					sent.placement,
					sent.approximateSize,
					sent.preferredDates,
					null,
					"NPR 15000",
					"instagram",
					"Maya Gurung",
					sent.contactPhone,
					"maya@example.com",
				],
			],
		);
		assert.deepEqual(
			rows.images.map((r) => [
				r.inquiryId,
				r.projectId,
				r.position,
				r.width,
				r.height,
			]),
			[
				[inquiry.id, null, 0, 300, 200],
				[inquiry.id, null, 1, 300, 200],
			],
		);
		assert.deepEqual(
			rows.images.map((r) => r.imageKey),
			images.keys,
		);
		for (const key of images.keys) {
			assert.match(key, new RegExp(`^tenants/${tenant.id}/reference_image/`));
			assert.isTrue(await exists(key), key);
		}
	});

	test("a returning client keeps their details; the inquiry keeps what was sent", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("intake-return-51");
		const { intake } = makeIntake();
		const client = await inTenant(tenant, () =>
			makeClient(tenant, {
				name: "Maya G.",
				email: null,
				notes: "Prefers mornings",
			}),
		);
		const stored = () =>
			inTenant(tenant, async () =>
				(await Client.findOrFail(client.id)).serialize(),
			);
		const before = await stored();

		const inquiry = await inTenant(tenant, () =>
			intake.submit(tenant, submission({ contactPhone: client.phone ?? "" })),
		);

		assert.deepEqual(await stored(), before);
		assert.equal(inquiry.clientId, client.id);
		assert.deepEqual(
			[inquiry.contactName, inquiry.contactPhone, inquiry.contactEmail],
			["Maya Gurung", client.phone, "maya@example.com"],
		);
	});

	test("a chosen artist must be a live, visible artist of the studio who accepts inquiries", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("intake-artist-51");
		const other = await studioWithOwner("intake-artist-b-51");
		const { intake, images } = makeIntake();
		const { hidden, gone, closed } = await inTenant(tenant, async () => {
			await Artist.create({ tenantId: tenant.id, name: "Bina", slug: "bina" });
			const gone = await Artist.create({
				tenantId: tenant.id,
				name: "Gone",
				slug: "gone",
			});
			await gone.softDelete();
			return {
				hidden: await Artist.create({
					tenantId: tenant.id,
					name: "Hidden",
					slug: "hidden",
					visible: false,
				}),
				gone,
				closed: await Artist.create({
					tenantId: tenant.id,
					name: "Sita",
					slug: "sita",
					acceptingInquiries: false,
				}),
			};
		});
		const foreign = await inTenant(other.tenant, () =>
			Artist.create({ tenantId: other.tenant.id, name: "Ram", slug: "ram" }),
		);

		for (const [label, artistId, reason] of [
			["unknown", randomUUID(), "artist_unavailable"],
			["hidden", hidden.id, "artist_unavailable"],
			["deleted", gone.id, "artist_unavailable"],
			["another studio's", foreign.id, "artist_unavailable"],
			["not accepting", closed.id, "artist_not_accepting"],
		] as const) {
			const refused = await reasonOf(async () =>
				inTenant(tenant, async () =>
					intake.submit(
						tenant,
						submission({
							preferredArtistId: artistId,
							referenceImages: await pngs(1),
						}),
					),
				),
			);
			assert.equal(refused, reason, label);
		}

		assert.deepEqual(images.keys, [], "no image was decoded");
		const rows = await rowsIn(tenant);
		assert.deepEqual([rows.clients.length, rows.inquiries.length], [0, 0]);
	});

	test("an open artist can be chosen, and no artist is fine while one is open", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("intake-open-51");
		const { intake } = makeIntake();
		const bina = await inTenant(tenant, () =>
			Artist.create({ tenantId: tenant.id, name: "Bina", slug: "bina" }),
		);

		const chosen = await inTenant(tenant, () =>
			intake.submit(tenant, submission({ preferredArtistId: bina.id })),
		);
		const any = await inTenant(tenant, () =>
			intake.submit(tenant, submission({ preferredArtistId: null })),
		);

		assert.equal(chosen.preferredArtistId, bina.id);
		assert.isNull(any.preferredArtistId);
	});

	test("with no artist chosen, a studio whose visible artists are all closed takes none", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("intake-closed-51");
		const { intake } = makeIntake();
		await inTenant(tenant, async () => {
			await Artist.create({
				tenantId: tenant.id,
				name: "Sita",
				slug: "sita",
				acceptingInquiries: false,
			});
			// A hidden artist doesn't keep the studio open.
			await Artist.create({
				tenantId: tenant.id,
				name: "Ram",
				slug: "ram",
				visible: false,
			});
		});

		assert.equal(
			await reasonOf(() =>
				inTenant(tenant, () => intake.submit(tenant, submission())),
			),
			"studio_not_accepting",
		);
	});

	test("a studio with no visible artists takes general inquiries", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("intake-none-51");
		const { intake } = makeIntake();

		assert.isNull(
			await reasonOf(() =>
				inTenant(tenant, () => intake.submit(tenant, submission())),
			),
		);
	});

	test("a phone with 3 open inquiries is refused; decided, deleted and other studios' don't count", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("intake-cap-51");
		const other = await studioWithOwner("intake-cap-b-51");
		const { intake, images } = makeIntake();
		const phone = nextPhone();
		await inTenant(tenant, async () => {
			// A deleted client's open inquiry still counts: the cap is per phone.
			const earlier = await makeClient(tenant, { phone });
			await makeInquiry(tenant, earlier);
			await earlier.softDelete();
			const client = await makeClient(tenant, { phone });
			await makeInquiry(tenant, client);
			await makeInquiry(tenant, client, {
				status: "declined",
				decidedAt: DateTime.now(),
			});
			await makeInquiry(tenant, client, {
				status: "accepted",
				decidedAt: DateTime.now(),
			});
			const gone = await makeInquiry(tenant, client);
			await gone.softDelete();
		});
		await inTenant(other.tenant, async () =>
			makeInquiry(other.tenant, await makeClient(other.tenant, { phone })),
		);

		// Two open: the third is taken.
		assert.isNull(
			await reasonOf(() =>
				inTenant(tenant, () =>
					intake.submit(tenant, submission({ contactPhone: phone })),
				),
			),
		);
		// Three open: the fourth is refused, before any image is decoded.
		const refused = await reasonOf(async () =>
			inTenant(tenant, async () =>
				intake.submit(
					tenant,
					submission({ contactPhone: phone, referenceImages: await pngs(1) }),
				),
			),
		);

		assert.equal(refused, "too_many_open_inquiries");
		assert.deepEqual(images.keys, []);
		const open = (await rowsIn(tenant)).inquiries.filter(
			(row) => row.status === "new",
		);
		assert.lengthOf(open, 3, "the two from before plus the one taken");
	});

	test("queues the staff alert with the inquiry, and none for a refusal", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("intake-alert-51");
		const { intake } = makeIntake();
		const fake = queue.fake();

		const inquiry = await inTenant(tenant, () =>
			intake.submit(tenant, submission()),
		);
		fake.assertPushed(NewInquiryAlertJob, {
			payload: { tenantId: tenant.id, inquiryId: inquiry.id },
		});
		fake.assertPushedCount(1);

		await inTenant(tenant, () =>
			Artist.create({
				tenantId: tenant.id,
				name: "Sita",
				slug: "sita",
				acceptingInquiries: false,
			}),
		);
		assert.equal(
			await reasonOf(() =>
				inTenant(tenant, () => intake.submit(tenant, submission())),
			),
			"studio_not_accepting",
		);
		fake.assertPushedCount(1);
	});

	test("a bad image 3 of 4 refuses the whole inquiry and deletes the images already stored", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("intake-atomic-51");
		const { intake, images } = makeIntake();
		const uploads = [
			...(await pngs(2)),
			await uploadOf(Buffer.from("<?php echo 'hi'; ?>")),
			...(await pngs(1)),
		];

		const error = await rejectionOf(() =>
			inTenant(tenant, () =>
				intake.submit(tenant, submission({ referenceImages: uploads })),
			),
		);

		assert.instanceOf(error, InvalidReferenceImageError);
		assert.equal((error as InvalidReferenceImageError).index, 2);
		assert.equal(
			(error as InvalidReferenceImageError).message,
			IMAGE_FORMAT_MESSAGE,
		);
		assert.lengthOf(images.keys, 2);
		for (const key of images.keys) assert.isFalse(await exists(key), key);
		const rows = await rowsIn(tenant);
		assert.deepEqual(
			[rows.clients.length, rows.inquiries.length, rows.images.length],
			[0, 0, 0],
		);
	});

	test("a storage failure after two images leaves no row and no file", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("intake-disk-51");
		const { intake, images } = makeIntake(new FailingImageService(3));

		await assert.rejects(
			async () =>
				inTenant(tenant, async () =>
					intake.submit(tenant, submission({ referenceImages: await pngs(3) })),
				),
			"disk full",
		);

		assert.lengthOf(images.keys, 2);
		for (const key of images.keys) assert.isFalse(await exists(key), key);
		const rows = await rowsIn(tenant);
		assert.deepEqual(
			[rows.clients.length, rows.inquiries.length, rows.images.length],
			[0, 0, 0],
		);
	});

	test("a failure later in the same transaction deletes the files and drops the alert", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("intake-later-51");
		const { intake, images } = makeIntake();
		const before = await queuedJobs(tenant);

		await assert.rejects(
			() =>
				withDbContext({ tenantId: tenant.id }, async () => {
					await intake.submit(
						tenant,
						submission({ referenceImages: await pngs(1) }),
					);
					throw new Error("later failure");
				}),
			"later failure",
		);

		assert.lengthOf(images.keys, 1);
		assert.isFalse(await exists(images.keys[0]));
		assert.lengthOf((await rowsIn(tenant)).inquiries, 0);
		assert.equal(await queuedJobs(tenant), before);

		// The positive control: a submit that commits leaves its job.
		await inTenant(tenant, () => intake.submit(tenant, submission()));
		assert.equal(await queuedJobs(tenant), before + 1);
	});
});
