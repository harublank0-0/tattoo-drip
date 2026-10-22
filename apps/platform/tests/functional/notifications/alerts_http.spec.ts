import app from "@adonisjs/core/services/app";
import testUtils from "@adonisjs/core/services/test_utils";
import type { ApiClient } from "@japa/api-client";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import User from "#models/user";
import Client from "#modules/clients/models/client";
import Inquiry from "#modules/inquiries/models/inquiry";
import StaffAlert from "#modules/notifications/models/staff_alert";
import AlertContentService from "#modules/notifications/services/alert_content_service";
import TattooProject from "#modules/projects/models/tattoo_project";
import TenantMembership from "#modules/tenancy/models/tenant_membership";
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

/** The live artist profile `slug` of `tenant`, linked to `user`. */
const profileFor = (
	tenant: { id: string },
	user: { id: string },
	slug = "mira",
) =>
	inTenant(tenant, async () => {
		const made = await makeArtist(tenant, slug);
		made.userId = user.id;
		await made.save();
		return made;
	});

/** An alert of `userId` about a fresh inquiry (from `name`, saying `idea`, asking for the artist `preferredArtistId`, when given). */
async function alertFor(
	tenant: { id: string },
	userId: string,
	over: {
		readAt?: DateTime;
		name?: string;
		idea?: string;
		preferredArtistId?: string;
	} = {},
) {
	const { name, idea, preferredArtistId, ...alert } = over;
	return inTenant(tenant, async () => {
		const inquiry = await makeInquiry(
			tenant,
			await makeClient(tenant, name ? { name } : {}),
			{
				...(idea ? { idea } : {}),
				...(preferredArtistId ? { preferredArtistId } : {}),
			},
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
		const profile = await profileFor(tenant, artist);
		const alert = await alertFor(tenant, artist.id, {
			name: "Sita Thapa",
			preferredArtistId: profile.id,
		});

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
		const profile = await profileFor(tenant, artist);
		const alert = await proofAlertFor(tenant, artist.id, {
			name: "Sita Thapa",
			artistId: profile.id,
		});

		const list = (await client.get(alertsPage()).withInertia().loginAs(artist))
			.inertiaProps;
		assert.deepInclude(list.alerts[0], {
			title: "A deposit screenshot for your project",
			detail: "Deposit from Sita: an owner checks it on the Payments card.",
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

	test("a deposit alert whose client was deleted says 'A client' and still shows the amount", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const proofAlert = await proofAlertFor(tenant, owner.id, { name: "Asha" });
		await inTenant(tenant, async () => {
			const project = await TattooProject.findOrFail(
				proofAlert.projectId as string,
			);
			await (await Client.findOrFail(project.clientId)).softDelete();
		});

		const list = (await client.get(alertsPage()).withInertia().loginAs(owner))
			.inertiaProps;

		assert.equal(list.alerts[0].detail, "A client: NPR 3,000");
	});

	test("an artist sees the client on their own projects only, and never an amount", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const artist = await artistIn(tenant);
		const mine = await profileFor(tenant, artist);
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
			"Deposit from Sita: an owner checks it on the Payments card.",
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

/** A user who is a member of `tenant` with `role`. */
async function memberIn(
	tenant: { id: string },
	email: string,
	role: "owner" | "artist",
) {
	const user = await User.create({ email, password: "secret-password" });
	const membership = await inTenant(tenant, () =>
		TenantMembership.create({ tenantId: tenant.id, userId: user.id, role }),
	);
	return { user, membership };
}

test.group("Alerts: who may read an inquiry's words (TAT-102)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	const ASK_OWNER = "An owner reviews it in the inbox.";

	/** Each alert's detail on `user`'s list, by alert id, and the whole list as text. */
	const listFor = async (client: ApiClient, user: User) => {
		const { alerts } = (
			await client.get(alertsPage()).withInertia().loginAs(user)
		).inertiaProps;
		return {
			details: new Map<string, string>(
				alerts.map(({ id, detail }: { id: string; detail: string }) => [
					id,
					detail,
				]),
			),
			text: JSON.stringify(alerts),
		};
	};

	test("an owner demoted to artist keeps the fixed line for inquiries that did not ask for them", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const { user: ram, membership } = await memberIn(
			tenant,
			"ram@black-needle.example",
			"owner",
		);
		const asha = await inTenant(tenant, () => makeArtist(tenant, "asha"));
		const unasked = await alertFor(tenant, ram.id, {
			name: "Sita Thapa",
			idea: "A koi fish up my calf",
		});
		const asked = await alertFor(tenant, ram.id, {
			name: "Bikash Rai",
			idea: "A moth for the wrist",
			preferredArtistId: asha.id,
		});
		assert.equal(
			(await listFor(client, ram)).details.get(unasked.id),
			"Sita: A koi fish up my calf",
			"as an owner he reads it",
		);

		await inTenant(tenant, async () => {
			membership.role = "artist";
			await membership.save();
		});
		const after = await listFor(client, ram);

		assert.equal(after.details.get(unasked.id), ASK_OWNER);
		assert.equal(after.details.get(asked.id), ASK_OWNER);
		assert.notMatch(after.text, /Sita|Bikash|koi|moth/);
	});

	test("an artist removed and invited again sees the fixed line, not the old inquiries' words", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const { user: ram, membership } = await memberIn(
			tenant,
			"ram@black-needle.example",
			"owner",
		);
		const alert = await alertFor(tenant, ram.id, {
			name: "Sita Thapa",
			idea: "A koi fish up my calf",
		});
		await inTenant(tenant, () => membership.softDelete());
		await inTenant(tenant, () =>
			TenantMembership.create({
				tenantId: tenant.id,
				userId: ram.id,
				role: "artist",
			}),
		);

		const after = await listFor(client, ram);

		assert.equal(after.details.get(alert.id), ASK_OWNER);
		assert.notMatch(after.text, /Sita|koi/);
	});

	test("the artist the client asked for still reads the words, only while the profile is theirs and live", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const mira = await artistIn(tenant);
		const profile = await profileFor(tenant, mira);
		const asha = await inTenant(tenant, () => makeArtist(tenant, "asha"));
		const mine = await alertFor(tenant, mira.id, {
			name: "सीता थापा",
			idea: "मेरो पिंडुलामा माछा",
			preferredArtistId: profile.id,
		});
		const hers = await alertFor(tenant, mira.id, {
			name: "Bikash Rai",
			idea: "A moth for the wrist",
			preferredArtistId: asha.id,
		});
		const nobodys = await alertFor(tenant, mira.id, { name: "Maya Gurung" });

		const list = await listFor(client, mira);

		assert.equal(list.details.get(mine.id), "सीता: मेरो पिंडुलामा माछा");
		assert.equal(list.details.get(hers.id), ASK_OWNER);
		assert.equal(list.details.get(nobodys.id), ASK_OWNER);
		assert.notMatch(list.text, /Bikash|moth|Maya/);

		// The profile is deleted: nothing is hers any more.
		await inTenant(tenant, () => profile.softDelete());
		const without = await listFor(client, mira);
		assert.equal(without.details.get(mine.id), ASK_OWNER);
		assert.notMatch(without.text, /सीता|माछा/);
	});

	test("a current owner reads every inquiry's words, asked for another artist or not", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const asha = await inTenant(tenant, () => makeArtist(tenant, "asha"));
		const hers = await alertFor(tenant, owner.id, {
			name: "Bikash Rai",
			idea: "A moth for the wrist",
			preferredArtistId: asha.id,
		});
		const nobodys = await alertFor(tenant, owner.id, {
			name: "Maya Gurung",
			idea: "A tiny star",
		});

		const list = await listFor(client, owner);

		assert.equal(list.details.get(hers.id), "Bikash: A moth for the wrist");
		assert.equal(list.details.get(nobodys.id), "Maya: A tiny star");
	});

	test("another studio's inquiries and projects never reach a list or the content service", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const { tenant: other } = await studioWithOwner(
			"other-studio",
			"Other Studio",
		);
		// The same person owns both studios; only A's alerts are on A's list.
		await memberIn(other, "second@other-studio.example", "owner");
		await inTenant(other, () =>
			TenantMembership.create({
				tenantId: other.id,
				userId: owner.id,
				role: "owner",
			}),
		);
		const theirs = await alertFor(other, owner.id, {
			name: "Secret Client",
			idea: "A secret idea",
		});
		const theirProof = await proofAlertFor(other, owner.id, {
			name: "Hidden Payer",
		});
		await alertFor(tenant, owner.id, { name: "Sita Thapa" });

		const list = await listFor(client, owner);
		assert.equal(list.details.size, 1);
		assert.notMatch(list.text, /Secret|Hidden/);

		// Asked about another studio's rows directly (forged ids), the service
		// finds nothing, for an owner as for an artist.
		const content = await app.container.make(AlertContentService);
		const forged = [theirs, theirProof].map((alert) => ({
			id: alert.id,
			kind: alert.kind,
			inquiryId: alert.inquiryId,
			projectId: alert.projectId,
			paymentId: alert.paymentId,
		}));
		for (const role of ["owner", "artist"] as const) {
			const found = await inTenant(tenant, () =>
				content.forAlerts(tenant, { userId: owner.id, role }, forged),
			);
			assert.equal(found.size, 0, role);
		}
	});

	test("an artist's page of alerts is read in a fixed number of queries", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const mira = await artistIn(tenant);
		const profile = await profileFor(tenant, mira);
		const queries = async () =>
			(
				await recordQueries(() =>
					client.get(alertsPage()).withInertia().loginAs(mira),
				)
			).queries.length;
		const add = async () => {
			await alertFor(tenant, mira.id, { preferredArtistId: profile.id });
			await proofAlertFor(tenant, mira.id, { artistId: profile.id });
		};
		await add();
		const few = await queries();
		for (let i = 0; i < 4; i++) await add();

		assert.equal(await queries(), few);
	});
});
