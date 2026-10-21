import testUtils from "@adonisjs/core/services/test_utils";
import db from "@adonisjs/lucid/services/db";
import queue from "@adonisjs/queue/services/main";
import { test } from "@japa/runner";
import type { SendMailPayload } from "#jobs/send_mail_job";
import User from "#models/user";
import ArtistService from "#modules/artists/services/artist_service";
import ImageService from "#modules/media/services/image_service";
import StaffAlert from "#modules/notifications/models/staff_alert";
import AlertService from "#modules/notifications/services/alert_service";
import type Payment from "#modules/payments/models/payment";
import type TattooProject from "#modules/projects/models/tattoo_project";
import type Tenant from "#modules/tenancy/models/tenant";
import TenantMembership from "#modules/tenancy/models/tenant_membership";
import TenancyService from "#modules/tenancy/services/tenancy_service";
import { withTransaction } from "#services/db_context";
import env from "#start/env";
import {
	makeArtist,
	makeClient,
	makeInquiry,
	makePayment,
	makeProject,
} from "#tests/helpers/pipeline";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";

const alerts = new AlertService(
	new TenancyService(),
	new ArtistService(new ImageService()),
);

type Fake = ReturnType<typeof queue.fake>;

/** The emails the fake queue holds: SendMailJob payloads. */
const mails = (fake: Fake) =>
	fake
		.getPushedJobs()
		.filter(({ job }) => job.name === "SendMailJob")
		.map(({ job }) => job.payload as SendMailPayload);

/** Who the emails go to, sorted. */
const recipients = (fake: Fake) =>
	mails(fake)
		.map(({ mailMessage }) => String(mailMessage.message.to?.[0]))
		.sort();

/** The template data of the email to `email`. */
const mailTo = (fake: Fake, email: string) =>
	mails(fake).find(({ mailMessage }) => mailMessage.message.to?.[0] === email)
		?.mailMessage.views.html?.data;

/** The users alerted about `inquiryId`, sorted. */
const alertedUsers = (tenant: { id: string }, inquiryId: string) =>
	inTenant(tenant, async () =>
		(await StaffAlert.query().where("inquiry_id", inquiryId))
			.map(({ userId }) => userId)
			.sort(),
	);

/** A member of `tenant` with `role`. */
async function memberIn(
	tenant: Tenant,
	email: string,
	role: "owner" | "artist",
) {
	const user = await User.create({ email, password: "secret-password" });
	await inTenant(tenant, () =>
		TenantMembership.create({ tenantId: tenant.id, userId: user.id, role }),
	);
	return user;
}

/** An artist profile in `tenant`, linked to `user` (or to nobody). */
const profileIn = (
	tenant: Tenant,
	slug: string,
	name: string,
	user: { id: string } | null,
) =>
	inTenant(tenant, async () => {
		const profile = await makeArtist(tenant, slug);
		profile.name = name;
		profile.userId = user?.id ?? null;
		await profile.save();
		return profile;
	});

const removeMembership = (tenant: Tenant, user: { id: string }) =>
	inTenant(tenant, async () =>
		(
			await TenantMembership.query().where("user_id", user.id).firstOrFail()
		).softDelete(),
	);

/** A deposit_pending project of `tenant` (assigned to `artistId` when given) and a submitted deposit payment: a screenshot that waits. */
const proofIn = (
	tenant: Tenant,
	over: { artistId?: string | null; clientName?: string } = {},
) =>
	inTenant(tenant, async () => {
		const client = await makeClient(tenant, {
			name: over.clientName ?? "Sita Rai",
		});
		const project = await makeProject(tenant, client, {
			status: "deposit_pending",
			artistId: over.artistId ?? null,
		});
		const payment = await makePayment(tenant, project, { method: "esewa" });
		return { client, project, payment };
	});

/** What DepositProofAlertJob hands AlertService.depositProof. */
const factsOf = ({
	project,
	payment,
	client,
}: {
	project: TattooProject;
	payment: Payment;
	client: { name: string };
}) => ({
	paymentId: payment.id,
	projectId: project.id,
	artistId: project.artistId,
	clientName: client.name,
});

/** The users alerted about `paymentId`, sorted. */
const proofAlertedUsers = (tenant: { id: string }, paymentId: string) =>
	inTenant(tenant, async () =>
		(await StaffAlert.query().where("payment_id", paymentId))
			.map(({ userId }) => userId)
			.sort(),
	);

test.group("AlertService.newInquiry", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.teardown(() => queue.restore());

	test("a new inquiry alerts every live owner and the asked-for artist's member, once each", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("alerts-52");
		const second = await memberIn(tenant, "second@alerts-52.example", "owner");
		const removed = await memberIn(
			tenant,
			"removed@alerts-52.example",
			"owner",
		);
		await removeMembership(tenant, removed);
		const asha = await artistIn(tenant, "asha@alerts-52.example");
		await artistIn(tenant, "ram@alerts-52.example");
		const profile = await profileIn(tenant, "asha", "Asha", asha);
		const inquiry = await inTenant(tenant, async () =>
			makeInquiry(tenant, await makeClient(tenant, { name: "Sita Rai" }), {
				preferredArtistId: profile.id,
			}),
		);
		const fake = queue.fake();

		const alerted = await inTenant(tenant, () =>
			alerts.newInquiry(tenant, inquiry, { emails: true }),
		);

		const expected = [owner.id, second.id, asha.id].sort();
		assert.deepEqual([...alerted].sort(), expected);
		assert.deepEqual(await alertedUsers(tenant, inquiry.id), expected);
		assert.deepEqual(
			recipients(fake),
			[owner.email, second.email, asha.email].sort(),
		);
	});

	test("the asked-for artist's email has no inbox link; an owner's links the inquiry", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner(
			"alerts-link-52",
			"Ink Link",
		);
		const asha = await artistIn(tenant, "asha@alerts-link-52.example");
		const profile = await profileIn(tenant, "asha", "Asha", asha);
		const inquiry = await inTenant(tenant, async () =>
			makeInquiry(tenant, await makeClient(tenant, { name: "Sita Rai" }), {
				preferredArtistId: profile.id,
			}),
		);
		const fake = queue.fake();

		await inTenant(tenant, () =>
			alerts.newInquiry(tenant, inquiry, { emails: true }),
		);

		assert.deepInclude(mailTo(fake, owner.email), {
			studioName: "Ink Link",
			intro: "Sita sent Ink Link a new tattoo inquiry and asked for Asha:",
			url: new URL(
				`/t/alerts-link-52/inbox/${inquiry.id}`,
				env.get("APP_URL"),
			).toString(),
		});
		assert.deepInclude(mailTo(fake, asha.email), {
			intro: "Sita sent Ink Link a new tattoo inquiry and asked for you:",
			url: null,
		});
	});

	test("a repeated run adds no alert and queues no second email", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("alerts-again-52");
		const inquiry = await inTenant(tenant, async () =>
			makeInquiry(tenant, await makeClient(tenant)),
		);
		const fake = queue.fake();

		const first = await inTenant(tenant, () =>
			alerts.newInquiry(tenant, inquiry, { emails: true }),
		);
		const second = await inTenant(tenant, () =>
			alerts.newInquiry(tenant, inquiry, { emails: true }),
		);

		assert.deepEqual(first, [owner.id]);
		assert.deepEqual(second, []);
		assert.deepEqual(await alertedUsers(tenant, inquiry.id), [owner.id]);
		assert.deepEqual(recipients(fake), [owner.email]);
	});

	test("an email is queued only with its alert: a rollback leaves neither", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("alerts-rollback-52");
		const inquiry = await inTenant(tenant, async () =>
			makeInquiry(tenant, await makeClient(tenant)),
		);
		// The real queue: a SendMailJob row's data carries the address.
		const queued = async () =>
			Number(
				(
					await db
						.from("queue_jobs")
						.where("data", "like", `%${owner.email}%`)
						.count("* as total")
				)[0].total,
			);

		await inTenant(tenant, () =>
			assert.rejects(
				() =>
					withTransaction(async () => {
						await alerts.newInquiry(tenant, inquiry, { emails: true });
						throw new Error("rolled back");
					}),
				/rolled back/,
			),
		);
		assert.deepEqual(await alertedUsers(tenant, inquiry.id), []);
		assert.equal(await queued(), 0);

		await inTenant(tenant, () =>
			alerts.newInquiry(tenant, inquiry, { emails: true }),
		);
		assert.deepEqual(await alertedUsers(tenant, inquiry.id), [owner.id]);
		assert.equal(await queued(), 1);
	});

	test("with emails off, the alerts are made and no email is queued", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("alerts-off-52");
		const inquiry = await inTenant(tenant, async () =>
			makeInquiry(tenant, await makeClient(tenant)),
		);
		const fake = queue.fake();

		await inTenant(tenant, () =>
			alerts.newInquiry(tenant, inquiry, { emails: false }),
		);

		assert.deepEqual(await alertedUsers(tenant, inquiry.id), [owner.id]);
		assert.deepEqual(mails(fake), []);
	});

	test("a deleted, unlinked or foreign preferred artist alerts the owners only", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("alerts-only-52");
		const { owner: stranger, tenant: theirs } =
			await studioWithOwner("alerts-other-52");
		const asha = await artistIn(tenant, "asha@alerts-only-52.example");
		const deleted = await profileIn(tenant, "gone", "Gone", asha);
		await inTenant(tenant, () => deleted.softDelete());
		const unlinked = await profileIn(tenant, "loose", "Loose", null);
		// Linked to a user who belongs to another studio only.
		const foreign = await profileIn(tenant, "foreign", "Foreign", stranger);
		const inquiries = await inTenant(tenant, async () => {
			const customer = await makeClient(tenant);
			const made = [];
			for (const profile of [deleted, unlinked, foreign]) {
				made.push(
					await makeInquiry(tenant, customer, {
						preferredArtistId: profile.id,
					}),
				);
			}
			return made;
		});

		for (const inquiry of inquiries) {
			assert.deepEqual(
				await inTenant(tenant, () =>
					alerts.newInquiry(tenant, inquiry, { emails: false }),
				),
				[owner.id],
			);
		}
		assert.lengthOf(await inTenant(theirs, () => StaffAlert.query()), 0);
	});

	test("the email carries the first name and the start of the idea, never the phone, email, budget or last name", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("alerts-content-52");
		const inquiry = await inTenant(tenant, async () =>
			makeInquiry(
				tenant,
				await makeClient(tenant, {
					name: "Sita Rai",
					phone: "+9779811112222",
					email: "sita@private.example",
				}),
				{
					budget: "NPR 99,999",
					idea: `A koi on the calf ${"with waves ".repeat(30)}`,
				},
			),
		);
		const fake = queue.fake();

		await inTenant(tenant, () =>
			alerts.newInquiry(tenant, inquiry, { emails: true }),
		);

		const [payload] = mails(fake);
		assert.equal(
			payload?.mailMessage.message.subject,
			"New inquiry for Black Needle",
		);
		const data = payload?.mailMessage.views.html?.data;
		assert.equal(data.intro, "Sita sent Black Needle a new tattoo inquiry:");
		assert.isTrue(data.excerpt.startsWith("A koi on the calf with waves"));
		assert.isAtMost(Array.from(data.excerpt as string).length, 141);
		const everything = JSON.stringify(payload);
		for (const secret of [
			"9811112222",
			"sita@private.example",
			"99,999",
			"Rai",
		]) {
			assert.notInclude(everything, secret, secret);
		}
	});

	test("TenancyService.members: live members with their account's email, oldest first", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("members-52");
		const asha = await artistIn(tenant, "asha@members-52.example");
		const gone = await artistIn(tenant, "gone@members-52.example");
		await removeMembership(tenant, gone);

		const listed = await inTenant(tenant, () =>
			new TenancyService().members(tenant),
		);
		assert.isTrue(listed.every(({ membershipId }) => membershipId.length > 0));
		assert.deepEqual(
			listed.map(({ userId, role, email, fullName }) => ({
				userId,
				role,
				email,
				fullName,
			})),
			[
				{ userId: owner.id, role: "owner", email: owner.email, fullName: null },
				{ userId: asha.id, role: "artist", email: asha.email, fullName: null },
			],
		);
	});
});

test.group("AlertService.depositProof (TAT-88)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.teardown(() => queue.restore());

	test("a deposit proof alerts every live owner and the project's artist's member, once each", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("proof-alerts-88");
		const second = await memberIn(
			tenant,
			"second@proof-alerts-88.example",
			"owner",
		);
		const removed = await memberIn(
			tenant,
			"removed@proof-alerts-88.example",
			"owner",
		);
		await removeMembership(tenant, removed);
		const asha = await artistIn(tenant, "asha@proof-alerts-88.example");
		await artistIn(tenant, "ram@proof-alerts-88.example");
		const profile = await profileIn(tenant, "asha", "Asha", asha);
		const proof = await proofIn(tenant, { artistId: profile.id });
		const fake = queue.fake();

		const alerted = await inTenant(tenant, () =>
			alerts.depositProof(tenant, factsOf(proof), { emails: true }),
		);

		const expected = [owner.id, second.id, asha.id].sort();
		assert.deepEqual([...alerted].sort(), expected);
		assert.deepEqual(
			await proofAlertedUsers(tenant, proof.payment.id),
			expected,
		);
		assert.deepEqual(
			recipients(fake),
			[owner.email, second.email, asha.email].sort(),
		);
		const rows = await inTenant(tenant, () =>
			StaffAlert.query().where("payment_id", proof.payment.id),
		);
		for (const row of rows) {
			assert.equal(row.kind, "deposit_proof");
			assert.equal(row.projectId, proof.project.id);
			assert.isNull(row.inquiryId);
			assert.isNull(row.readAt);
		}
	});

	test("the owner's email checks the screenshot, the artist's opens the project, both at the Payments card", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner(
			"proof-link-88",
			"Ink Link",
		);
		const asha = await artistIn(tenant, "asha@proof-link-88.example");
		const profile = await profileIn(tenant, "asha", "Asha", asha);
		const proof = await proofIn(tenant, { artistId: profile.id });
		const fake = queue.fake();

		await inTenant(tenant, () =>
			alerts.depositProof(tenant, factsOf(proof), { emails: true }),
		);

		const url = new URL(
			`/t/proof-link-88/projects/${proof.project.id}#payments`,
			env.get("APP_URL"),
		).toString();
		assert.deepInclude(mailTo(fake, owner.email), {
			studioName: "Ink Link",
			intro: "Sita sent Ink Link a deposit screenshot.",
			forOwner: true,
			url,
		});
		assert.deepInclude(mailTo(fake, asha.email), {
			intro: "Sita sent Ink Link a deposit screenshot for your project.",
			forOwner: false,
			url,
		});
	});

	test("a repeated run adds nothing; a new screenshot (a new payment) alerts again", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("proof-again-88");
		const first = await proofIn(tenant);
		const fake = queue.fake();
		const run = (proof: Parameters<typeof factsOf>[0]) =>
			inTenant(tenant, () =>
				alerts.depositProof(tenant, factsOf(proof), { emails: true }),
			);

		assert.deepEqual(await run(first), [owner.id]);
		assert.deepEqual(await run(first), []);
		// After a rejection the deposit page takes the client's next
		// screenshot as a new payment of the same project.
		const next = {
			...first,
			payment: await inTenant(tenant, () =>
				makePayment(tenant, first.project, { method: "esewa" }),
			),
		};
		assert.deepEqual(await run(next), [owner.id]);

		assert.deepEqual(await proofAlertedUsers(tenant, first.payment.id), [
			owner.id,
		]);
		assert.deepEqual(await proofAlertedUsers(tenant, next.payment.id), [
			owner.id,
		]);
		assert.deepEqual(recipients(fake), [owner.email, owner.email]);
	});

	test("a rollback leaves neither the alert nor its email", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("proof-rollback-88");
		const proof = await proofIn(tenant);
		// The real queue: a SendMailJob row's data carries the address.
		const queued = async () =>
			Number(
				(
					await db
						.from("queue_jobs")
						.where("data", "like", `%${owner.email}%`)
						.count("* as total")
				)[0].total,
			);

		await inTenant(tenant, () =>
			assert.rejects(
				() =>
					withTransaction(async () => {
						await alerts.depositProof(tenant, factsOf(proof), {
							emails: true,
						});
						throw new Error("rolled back");
					}),
				/rolled back/,
			),
		);
		assert.deepEqual(await proofAlertedUsers(tenant, proof.payment.id), []);
		assert.equal(await queued(), 0);

		await inTenant(tenant, () =>
			alerts.depositProof(tenant, factsOf(proof), { emails: true }),
		);
		assert.deepEqual(await proofAlertedUsers(tenant, proof.payment.id), [
			owner.id,
		]);
		assert.equal(await queued(), 1);
	});

	test("with emails off, the alerts are made and no email is queued", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("proof-off-88");
		const proof = await proofIn(tenant);
		const fake = queue.fake();

		await inTenant(tenant, () =>
			alerts.depositProof(tenant, factsOf(proof), { emails: false }),
		);

		assert.deepEqual(await proofAlertedUsers(tenant, proof.payment.id), [
			owner.id,
		]);
		assert.deepEqual(mails(fake), []);
	});

	test("an unassigned project, or an unlinked, deleted or outside profile, alerts the owners only", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("proof-only-88");
		const { owner: stranger, tenant: theirs } =
			await studioWithOwner("proof-other-88");
		const asha = await artistIn(tenant, "asha@proof-only-88.example");
		const deleted = await profileIn(tenant, "gone", "Gone", asha);
		await inTenant(tenant, () => deleted.softDelete());
		const unlinked = await profileIn(tenant, "loose", "Loose", null);
		// Linked to a user who belongs to another studio only.
		const foreign = await profileIn(tenant, "foreign", "Foreign", stranger);

		for (const artistId of [null, deleted.id, unlinked.id, foreign.id]) {
			const proof = await proofIn(tenant, { artistId });
			assert.deepEqual(
				await inTenant(tenant, () =>
					alerts.depositProof(tenant, factsOf(proof), { emails: false }),
				),
				[owner.id],
				String(artistId),
			);
		}
		assert.lengthOf(await inTenant(theirs, () => StaffAlert.query()), 0);
	});

	test("the email names the client by first name only, Devanagari intact, and never the amount, method, phone or a deposit link", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("proof-content-88");
		const proof = await proofIn(tenant, { clientName: "सीता राई" });
		const fake = queue.fake();

		await inTenant(tenant, () =>
			alerts.depositProof(tenant, factsOf(proof), { emails: true }),
		);

		const [payload] = mails(fake);
		assert.equal(
			payload?.mailMessage.message.subject,
			"Deposit screenshot for Black Needle",
		);
		assert.equal(
			payload?.mailMessage.views.html?.data.intro,
			"सीता sent Black Needle a deposit screenshot.",
		);
		// The message and the data of both views; not the view names, which
		// contain "/deposit" themselves ("emails/deposit_proof").
		const { message, views } = payload.mailMessage;
		const everything = JSON.stringify([
			message,
			views.html?.data,
			views.text?.data,
		]);
		for (const secret of [
			"राई",
			// The phone's digits after the country code (String(): the column is nullable).
			String(proof.client.phone).slice(4),
			"300000",
			"3,000",
			"esewa",
			"/deposit",
			proof.payment.id,
		]) {
			assert.notInclude(everything, secret, secret);
		}
	});
});
