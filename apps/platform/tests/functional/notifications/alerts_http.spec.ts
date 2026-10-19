import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import StaffAlert from "#modules/notifications/models/staff_alert";
import { makeClient, makeInquiry } from "#tests/helpers/pipeline";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";

const alertsPage = (rest = "") => `/t/black-needle/alerts${rest}`;

/** An alert of `userId` about a fresh inquiry. */
async function alertFor(
	tenant: { id: string },
	userId: string,
	over: { readAt?: DateTime } = {},
) {
	return inTenant(tenant, async () => {
		const inquiry = await makeInquiry(tenant, await makeClient(tenant));
		return StaffAlert.create({
			tenantId: tenant.id,
			userId,
			kind: "new_inquiry",
			inquiryId: inquiry.id,
			...over,
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
		const newer = await alertFor(tenant, owner.id);
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
			detail: "Open it in the inbox.",
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
		const alert = await alertFor(tenant, artist.id);

		const list = (await client.get(alertsPage()).withInertia().loginAs(artist))
			.inertiaProps;
		assert.deepInclude(list.alerts[0], {
			title: "A new inquiry asks for you",
			detail: "An owner reviews it in the inbox.",
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
});
