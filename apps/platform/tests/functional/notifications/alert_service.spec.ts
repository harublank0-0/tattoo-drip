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
import type Tenant from "#modules/tenancy/models/tenant";
import TenantMembership from "#modules/tenancy/models/tenant_membership";
import TenancyService from "#modules/tenancy/services/tenancy_service";
import { withTransaction } from "#services/db_context";
import env from "#start/env";
import { makeArtist, makeClient, makeInquiry } from "#tests/helpers/pipeline";
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
