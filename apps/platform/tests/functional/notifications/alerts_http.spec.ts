import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import Inquiry from "#modules/inquiries/models/inquiry";
import StaffAlert from "#modules/notifications/models/staff_alert";
import TattooProject from "#modules/projects/models/tattoo_project";
import {
	makeArtist,
	makeClient,
	makeInquiry,
	makePayment,
	makeProject,
} from "#tests/helpers/pipeline";
import { recordQueries } from "#tests/helpers/query_count";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";

const alertsPage = (rest = "") => `/t/black-needle/alerts${rest}`;

/** An alert of `userId` about a fresh inquiry (from `name`, saying `idea`, when given). */
async function alertFor(
	tenant: { id: string },
	userId: string,
	over: { readAt?: DateTime; name?: string; idea?: string } = {},
) {
	const { name, idea, ...alert } = over;
	return inTenant(tenant, async () => {
		const inquiry = await makeInquiry(
			tenant,
			await makeClient(tenant, name ? { name } : {}),
			idea ? { idea } : {},
		);
		return StaffAlert.create({
			tenantId: tenant.id,
			userId,
			kind: "new_inquiry",
			inquiryId: inquiry.id,
			...alert,
		});
	});
}

/** An alert of `userId` about a deposit screenshot on a fresh project (of `name`, assigned to `artistId`, claiming `amount` paisa, when given). */
async function proofAlertFor(
	tenant: { id: string },
	userId: string,
	over: { name?: string; artistId?: string; amount?: number } = {},
) {
	return inTenant(tenant, async () => {
		const project = await makeProject(
			tenant,
			await makeClient(tenant, over.name ? { name: over.name } : {}),
			{ status: "deposit_pending", artistId: over.artistId ?? null },
		);
		const payment = await makePayment(
			tenant,
			project,
			over.amount ? { amount: over.amount } : {},
		);
		return StaffAlert.create({
			tenantId: tenant.id,
			userId,
			kind: "deposit_proof",
			projectId: project.id,
			paymentId: payment.id,
		});
	});
}

const reload = (tenant: { id: string }, alert: StaffAlert) =>
	inTenant(tenant, () => StaffAlert.findOrFail(alert.id));

test.group("Alerts", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("the list shows the member's own alerts, newest first, with unread marked", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const artist = await artistIn(tenant);
		const older = await alertFor(tenant, owner.id, { readAt: DateTime.now() });
		const newer = await alertFor(tenant, owner.id, { name: "Sita Thapa" });
		await alertFor(tenant, artist.id);

		const response = await client
			.get(alertsPage())
			.withInertia()
			.loginAs(owner);

		response.assertStatus(200);
		response.assertInertiaComponent("alerts/index");
		const props = response.inertiaProps;
		assert.deepEqual(
			props.alerts.map(({ id, unread }: { id: string; unread: boolean }) => [
				id,
				unread,
			]),
			[
				[newer.id, true],
				[older.id, false],
			],
		);
		assert.deepInclude(props.alerts[0], {
			title: "New inquiry",
			detail: "Sita: A small fine-line moth",
		});
		assert.match(props.alerts[0].whenText, /^Today, \d\d:\d\d$/);
		assert.equal(props.unread, 1);
		assert.deepEqual(props.page, { current: 1, last: 1, total: 2 });
	});

	test("a page past the last one is empty but still reports the total", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		await alertFor(tenant, owner.id);
		await alertFor(tenant, owner.id);

		const props = (
			await client.get(alertsPage("?page=9")).withInertia().loginAs(owner)
		).inertiaProps;

		// The page says "No alerts on this page." from a total above 0.
		assert.deepEqual(props.alerts, []);
		assert.deepEqual(props.page, { current: 9, last: 1, total: 2 });
	});

	test("opening an owner's alert marks it read once and opens its inquiry", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const alert = await alertFor(tenant, owner.id);
		const open = () =>
			client
				.post(alertsPage(`/${alert.id}/open`))
				.withCsrfToken()
				.loginAs(owner)
				.redirects(0);

		const response = await open();

		response.assertStatus(302);
		response.assertHeader(
			"location",
			`/t/black-needle/inbox/${alert.inquiryId}`,
		);
		const read = (await reload(tenant, alert)).readAt;
		assert.isNotNull(read);
		await open();
		assert.equal(
			(await reload(tenant, alert)).readAt?.toMillis(),
			read?.toMillis(),
			"opening it again keeps its first read time",
		);
	});

	test("an artist's alert has the artist's line and opens back to the list", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const artist = await artistIn(tenant);
		const alert = await alertFor(tenant, artist.id, { name: "Sita Thapa" });

		const list = (await client.get(alertsPage()).withInertia().loginAs(artist))
			.inertiaProps;
		assert.deepInclude(list.alerts[0], {
			title: "A new inquiry asks for you",
			detail: "Sita: A small fine-line moth",
		});

		const response = await client
			.post(alertsPage(`/${alert.id}/open`))
			.withCsrfToken()
			.loginAs(artist)
			.redirects(0);
		response.assertStatus(302);
		response.assertHeader("location", alertsPage());
		assert.isNotNull((await reload(tenant, alert)).readAt);
	});

	test("another member's alert is a 404 and stays unread", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const artist = await artistIn(tenant);
		const theirs = await alertFor(tenant, artist.id);

		const response = await client
			.post(alertsPage(`/${theirs.id}/open`))
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		response.assertStatus(404);
		assert.isNull((await reload(tenant, theirs)).readAt);
	});

	test("Mark all as read clears the member's own alerts only", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const artist = await artistIn(tenant);
		const mine = [
			await alertFor(tenant, owner.id),
			await alertFor(tenant, owner.id),
		];
		const theirs = await alertFor(tenant, artist.id);

		const response = await client
			.post(alertsPage("/read"))
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		response.assertStatus(302);
		response.assertHeader("location", alertsPage());
		response.assertFlashMessage("success", "All alerts marked as read.");
		for (const alert of mine) {
			assert.isNotNull((await reload(tenant, alert)).readAt);
		}
		assert.isNull((await reload(tenant, theirs)).readAt);
	});

	test("the shell counts each member's own unread alerts on every tenant page", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const artist = await artistIn(tenant);
		await alertFor(tenant, owner.id);
		await alertFor(tenant, owner.id);
		await alertFor(tenant, owner.id, { readAt: DateTime.now() });
		await alertFor(tenant, artist.id);

		const ownerProps = (
			await client.get("/t/black-needle/projects").withInertia().loginAs(owner)
		).inertiaProps;
		assert.equal(ownerProps.alertCount, 2);
		const artistProps = (
			await client.get("/t/black-needle/calendar").withInertia().loginAs(artist)
		).inertiaProps;
		assert.equal(artistProps.alertCount, 1);
	});

	test("a deposit-proof alert reads its line and opens the project's Payments card", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const alert = await proofAlertFor(tenant, owner.id, { name: "Sita Thapa" });

		const list = (await client.get(alertsPage()).withInertia().loginAs(owner))
			.inertiaProps;
		assert.deepInclude(list.alerts[0], {
			title: "Deposit screenshot to check",
			detail: "Sita: NPR 3,000",
		});

		const response = await client
			.post(alertsPage(`/${alert.id}/open`))
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		response.assertStatus(302);
		response.assertHeader(
			"location",
			`/t/black-needle/projects/${alert.projectId}#payments`,
		);
		assert.isNotNull((await reload(tenant, alert)).readAt);
	});

	test("from the dashboard, opening it is a location visit that keeps #payments", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const alert = await proofAlertFor(tenant, owner.id);

		const response = await client
			.post(alertsPage(`/${alert.id}/open`))
			.withCsrfToken()
			.withInertia()
			.loginAs(owner)
			.redirects(0);

		response.assertStatus(409);
		response.assertHeader(
			"x-inertia-location",
			`/t/black-needle/projects/${alert.projectId}#payments`,
		);
		assert.isNotNull((await reload(tenant, alert)).readAt);
	});

	test("the project's artist gets the artist's line and the same Payments card", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const artist = await artistIn(tenant);
		const profile = await inTenant(tenant, async () => {
			const made = await makeArtist(tenant, "mira");
			made.userId = artist.id;
			await made.save();
			return made;
		});
		const alert = await proofAlertFor(tenant, artist.id, {
			name: "Sita Thapa",
			artistId: profile.id,
		});

		const list = (await client.get(alertsPage()).withInertia().loginAs(artist))
			.inertiaProps;
		assert.deepInclude(list.alerts[0], {
			title: "A deposit screenshot for your project",
			detail: "Sita: An owner checks it on the Payments card.",
		});

		const response = await client
			.post(alertsPage(`/${alert.id}/open`))
			.withCsrfToken()
			.loginAs(artist)
			.redirects(0);
		response.assertStatus(302);
		response.assertHeader(
			"location",
			`/t/black-needle/projects/${alert.projectId}#payments`,
		);
	});
});

test.group("Alerts: what they say (TAT-102)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a Devanagari name and idea reach the list whole, and no phone number does", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const alert = await alertFor(tenant, owner.id, {
			name: "सीता थापा",
			idea: "मेरो पिंडुलामा माछा ".repeat(10),
		});
		const phone = String(
			await inTenant(
				tenant,
				async () =>
					(await Inquiry.findOrFail(alert.inquiryId as string)).contactPhone,
			),
		);

		const response = await client
			.get(alertsPage())
			.withInertia()
			.loginAs(owner);

		assert.equal(
			response.inertiaProps.alerts[0].detail,
			`सीता: ${Array(7).fill("मेरो पिंडुलामा माछा").join(" ")} मेरो…`,
		);
		assert.match(phone, /^\+\d{8,}$/);
		assert.notInclude(JSON.stringify(response.inertiaProps), phone);
	});

	test("a deposit screenshot reads as the first name and the amount in rupees", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		await proofAlertFor(tenant, owner.id, {
			name: "सीता थापा",
			amount: 15_000_000,
		});

		const list = (await client.get(alertsPage()).withInertia().loginAs(owner))
			.inertiaProps;

		assert.equal(list.alerts[0].detail, "सीता: NPR 1,50,000");
	});

	test("an alert whose inquiry or project is gone keeps the old line", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const inquiryAlert = await alertFor(tenant, owner.id, { name: "Sita" });
		const proofAlert = await proofAlertFor(tenant, owner.id, { name: "Asha" });
		await inTenant(tenant, async () => {
			await (
				await Inquiry.findOrFail(inquiryAlert.inquiryId as string)
			).softDelete();
			await (
				await TattooProject.findOrFail(proofAlert.projectId as string)
			).softDelete();
		});

		const list = (await client.get(alertsPage()).withInertia().loginAs(owner))
			.inertiaProps;

		assert.deepEqual(
			list.alerts.map(({ id, detail }: { id: string; detail: string }) => [
				id,
				detail,
			]),
			[
				[proofAlert.id, "Open the project's Payments card."],
				[inquiryAlert.id, "Open it in the inbox."],
			],
		);
	});

	test("an artist sees the client on their own projects only, and never an amount", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const artist = await artistIn(tenant);
		const mine = await inTenant(tenant, async () => {
			const made = await makeArtist(tenant, "mira");
			made.userId = artist.id;
			await made.save();
			return made;
		});
		const other = await inTenant(tenant, () => makeArtist(tenant, "asha"));
		const own = await proofAlertFor(tenant, artist.id, {
			name: "Sita Thapa",
			artistId: mine.id,
		});
		const elsewhere = await proofAlertFor(tenant, artist.id, {
			name: "Asha Rai",
			artistId: other.id,
		});

		const list = (await client.get(alertsPage()).withInertia().loginAs(artist))
			.inertiaProps;

		const byId = new Map<string, string>(
			list.alerts.map(({ id, detail }: { id: string; detail: string }) => [
				id,
				detail,
			]),
		);
		assert.equal(
			byId.get(own.id),
			"Sita: An owner checks it on the Payments card.",
		);
		// Reassigned or never theirs: the project page would be a 404, so the
		// list says nothing about the client either.
		assert.equal(
			byId.get(elsewhere.id),
			"An owner checks it on the Payments card.",
		);
		assert.notInclude(JSON.stringify(list), "NPR");
	});

	test("a page of alerts is read in a fixed number of queries", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const queries = async () =>
			(
				await recordQueries(() =>
					client.get(alertsPage()).withInertia().loginAs(owner),
				)
			).queries.length;
		await alertFor(tenant, owner.id);
		await proofAlertFor(tenant, owner.id);
		const few = await queries();
		for (let i = 0; i < 4; i++) {
			await alertFor(tenant, owner.id);
			await proofAlertFor(tenant, owner.id);
		}

		assert.equal(await queries(), few);
	});
});
