import testUtils from "@adonisjs/core/services/test_utils";
import type { ApiClient, ApiResponse } from "@japa/api-client";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import type User from "#models/user";
import { lastBookableDay, todayIn } from "#modules/projects/quotes";
import { MAX_UPCOMING_CLOSURES } from "#modules/scheduling/opening_hours";
import OpeningHoursService from "#modules/scheduling/services/opening_hours_service";
import Tenant from "#modules/tenancy/models/tenant";
import { recordQueries } from "#tests/helpers/query_count";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";
import { assertValidationError } from "#tests/helpers/validation";

const hours = new OpeningHoursService();
const KTM = "Asia/Kathmandu";
const today = () => todayIn(KTM);
const inDays = (days: number) =>
	DateTime.fromISO(today(), { zone: "utc" })
		.plus({ days })
		.toFormat("yyyy-MM-dd");

const reload = (tenant: { id: string }) =>
	inTenant(tenant, () => Tenant.findOrFail(tenant.id));

type Studio = { slug: string };

const page = (client: ApiClient, user: User, tenant: Studio) =>
	client
		.get(`/t/${tenant.slug}/settings/good-to-know`)
		.withInertia()
		.loginAs(user);

const send = (
	client: ApiClient,
	user: User,
	method: "put" | "post" | "delete",
	path: string,
	body?: Record<string, unknown>,
) => {
	const request = client[method](path).withCsrfToken();
	if (body) request.form(body);
	return request.loginAs(user).redirects(0);
};

const putHours = (
	client: ApiClient,
	user: User,
	tenant: Studio,
	body: Record<string, unknown>,
) => send(client, user, "put", `/t/${tenant.slug}/settings/hours`, body);

const postClosed = (
	client: ApiClient,
	user: User,
	tenant: Studio,
	body: Record<string, unknown>,
) => send(client, user, "post", `/t/${tenant.slug}/settings/closed-days`, body);

const putTexts = (
	client: ApiClient,
	user: User,
	tenant: Studio,
	body: Record<string, unknown>,
) => send(client, user, "put", `/t/${tenant.slug}/settings/good-to-know`, body);

/**
 * The error shown under a day's row. assertValidationError reads its field
 * as a nested path, which "hours.mon" is not: the bag's key holds the dot.
 */
function assertDayError(response: ApiResponse, day: string, message: string) {
	response.assert?.deepEqual(
		response.flashMessage("inputErrorsBag")?.[`hours.${day}`],
		[message],
	);
}

const ALL_TEXTS = {
	walkIns: "",
	ageRule: "",
	beforeSession: "",
	aftercare: "",
};

test.group("Settings, Good to know: the page (TAT-128)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("it gives the week Sunday first, the upcoming closed days worded, the texts and the dates", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("know-page");
		await inTenant(tenant, async () => {
			await hours.replaceWeek(tenant, [
				{ day: "mon", opens: "10:30", closes: "18:00" },
				{ day: "sun", opens: "09:00", closes: "13:00" },
			]);
			await hours.addClosure(
				tenant,
				{ startsOn: "2099-10-20", endsOn: "2099-10-20", note: "Back soon" },
				today(),
			);
			await hours.addClosure(
				tenant,
				{ startsOn: "2020-10-01", endsOn: "2020-10-03", note: "Long ago" },
				"2020-10-01",
			);
			tenant.merge({
				walkInsText: "Small flash only.",
				ageRuleText: null,
				beforeSessionText: "Eat well.",
				aftercareText: "दिनमा दुई पटक सफा गर्नुहोस्।",
				depositPolicy: "  \n ",
			});
			await tenant.save();
		});

		const response = await page(client, owner, tenant);

		response.assertStatus(200);
		response.assertInertiaComponent("settings/good_to_know");
		const props = response.inertiaProps;
		assert.equal(props.timezone, KTM);
		assert.deepEqual(
			props.week.map((row: { day: string }) => row.day),
			["sun", "mon", "tue", "wed", "thu", "fri", "sat"],
		);
		assert.deepEqual(props.week[0], {
			day: "sun",
			open: true,
			opens: "09:00",
			closes: "13:00",
		});
		assert.deepEqual(props.week[1], {
			day: "mon",
			open: true,
			opens: "10:30",
			closes: "18:00",
		});
		assert.deepEqual(props.week[2], {
			day: "tue",
			open: false,
			opens: "11:00",
			closes: "20:00",
		});
		assert.lengthOf(props.closedDays, 1);
		assert.deepEqual(
			{ ...props.closedDays[0], id: "x" },
			{ id: "x", when: "Tue 20 Oct 2099", note: "Back soon" },
		);
		assert.deepEqual(props.texts, {
			walkIns: "Small flash only.",
			ageRule: null,
			beforeSession: "Eat well.",
			aftercare: "दिनमा दुई पटक सफा गर्नुहोस्।",
		});
		assert.isFalse(props.hasDepositPolicy);
		assert.deepEqual(props.dates, {
			today: today(),
			max: lastBookableDay(today()),
		});
	});

	test("a studio that set nothing gets seven closed rows and empty lists", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("know-empty");

		const props = (await page(client, owner, tenant)).inertiaProps;

		assert.lengthOf(props.week, 7);
		assert.isTrue(props.week.every((row: { open: boolean }) => !row.open));
		assert.deepEqual(props.closedDays, []);
		assert.deepEqual(props.texts, {
			walkIns: null,
			ageRule: null,
			beforeSession: null,
			aftercare: null,
		});
	});

	test("it says whether a deposit policy is written", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("know-policy");
		await inTenant(tenant, async () => {
			tenant.merge({ depositPolicy: "Deposits hold your date." });
			await tenant.save();
		});

		const props = (await page(client, owner, tenant)).inertiaProps;

		assert.isTrue(props.hasDepositPolicy);
		assert.notInclude(JSON.stringify(props), "Deposits hold your date.");
	});

	test("it says when Good to know is hidden on the studio page", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("know-hidden");

		assert.isTrue((await page(client, owner, tenant)).inertiaProps.shownOnPage);

		await inTenant(tenant, async () => {
			tenant.merge({ storefrontSections: "work,artists,inquiry" });
			await tenant.save();
		});
		assert.isFalse(
			(await page(client, owner, tenant)).inertiaProps.shownOnPage,
		);

		await inTenant(tenant, async () => {
			tenant.merge({ storefrontSections: "info,inquiry" });
			await tenant.save();
		});
		assert.isTrue((await page(client, owner, tenant)).inertiaProps.shownOnPage);
	});

	test("it reads the hours and the closed days with one query each", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("know-queries");
		await inTenant(tenant, () =>
			hours.replaceWeek(tenant, [
				{ day: "mon", opens: "11:00", closes: "20:00" },
			]),
		);

		const { queries } = await recordQueries(async () =>
			(await page(client, owner, tenant)).assertStatus(200),
		);

		const reads = (table: string) =>
			queries.filter((sql) => sql.startsWith("select") && sql.includes(table));
		assert.lengthOf(reads('"studio_hours"'), 1);
		assert.lengthOf(reads('"studio_closures"'), 1);
	});
});

test.group("Settings, Good to know: saving the hours (TAT-128)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("it stores the ticked days and redirects with the saved message", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("know-hours");

		const response = await putHours(client, owner, tenant, {
			"hours[sun][open]": "1",
			"hours[sun][opens]": "10:00",
			"hours[sun][closes]": "18:00",
			"hours[mon][open]": "1",
			"hours[mon][opens]": "11:00",
			"hours[mon][closes]": "20:00",
			// Not ticked: whatever times came with it, the day is closed.
			"hours[tue][opens]": "11:00",
			"hours[tue][closes]": "20:00",
		});

		response.assertStatus(302);
		response.assertHeader(
			"location",
			`/t/${tenant.slug}/settings/good-to-know`,
		);
		// The sentence a real save sends, spelled out here (not the constant it comes from).
		response.assertFlashMessage(
			"success",
			"Opening hours saved. They can take up to 15 minutes to show on your page.",
		);
		assert.deepEqual(await inTenant(tenant, () => hours.week(tenant)), [
			{ day: "sun", opens: "10:00", closes: "18:00" },
			{ day: "mon", opens: "11:00", closes: "20:00" },
		]);
	});

	test("saving a week with no ticked day closes every day", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("know-hours-none");
		await inTenant(tenant, () =>
			hours.replaceWeek(tenant, [
				{ day: "mon", opens: "11:00", closes: "20:00" },
			]),
		);

		const response = await putHours(client, owner, tenant, {});

		response.assertStatus(302);
		assert.deepEqual(await inTenant(tenant, () => hours.week(tenant)), []);
	});

	test("a day closing before it opens is an error under that day and nothing changes", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("know-hours-bad");
		await inTenant(tenant, () =>
			hours.replaceWeek(tenant, [
				{ day: "fri", opens: "11:00", closes: "20:00" },
			]),
		);

		const response = await putHours(client, owner, tenant, {
			"hours[mon][open]": "1",
			"hours[mon][opens]": "20:00",
			"hours[mon][closes]": "11:00",
		});

		response.assertStatus(302);
		assertDayError(
			response,
			"mon",
			"Close after you open. Hours can't run past midnight.",
		);
		assert.deepEqual(await inTenant(tenant, () => hours.week(tenant)), [
			{ day: "fri", opens: "11:00", closes: "20:00" },
		]);
	});

	test("an emptied time box is the same kind of error", async ({ client }) => {
		const { owner, tenant } = await studioWithOwner("know-hours-empty");

		const response = await putHours(client, owner, tenant, {
			"hours[wed][open]": "1",
			"hours[wed][opens]": "",
			"hours[wed][closes]": "20:00",
		});

		assertDayError(response, "wed", "Enter both times, like 11:00 and 20:00.");
	});
});

test.group("Settings, Good to know: closed days (TAT-128)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("adding stores them; the last day defaults to the first", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("know-closed");

		const one = await postClosed(client, owner, tenant, {
			closedFrom: inDays(5),
			closedTo: "",
			closedNote: "",
		});
		const range = await postClosed(client, owner, tenant, {
			closedFrom: inDays(10),
			closedTo: inDays(12),
			closedNote: "दशैं बिदा",
		});

		one.assertStatus(302);
		one.assertHeader("location", `/t/${tenant.slug}/settings/good-to-know`);
		one.assertFlashMessage(
			"success",
			"Closed days added. They can take up to 15 minutes to show on your page.",
		);
		range.assertStatus(302);
		const rows = await inTenant(tenant, () =>
			hours.upcomingClosures(tenant, today()),
		);
		assert.deepEqual(
			rows.map((row) => [
				row.startsOn.toISODate(),
				row.endsOn.toISODate(),
				row.note,
			]),
			[
				[inDays(5), inDays(5), null],
				[inDays(10), inDays(12), "दशैं बिदा"],
			],
		);
	});

	test("a past day or a too long range is a field error and nothing is stored", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("know-closed-bad");

		const past = await postClosed(client, owner, tenant, {
			closedFrom: inDays(-1),
		});
		const long = await postClosed(client, owner, tenant, {
			closedFrom: inDays(5),
			closedTo: inDays(65),
		});
		const note = await postClosed(client, owner, tenant, {
			closedFrom: inDays(5),
			closedNote: "x".repeat(121),
		});

		assertValidationError(
			past,
			"closedFrom",
			"Pick a day from today to a year from now.",
		);
		assertValidationError(
			long,
			"closedTo",
			"Pick the same day or a later one, at most 60 days after the first.",
		);
		assertValidationError(
			note,
			"closedNote",
			"Keep the note to one line of 120 characters or fewer.",
		);
		assert.lengthOf(
			await inTenant(tenant, () => hours.upcomingClosures(tenant, today())),
			0,
		);
	});

	test("the 21st upcoming one is refused on closedFrom with the limit sentence", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("know-closed-limit");
		await inTenant(tenant, async () => {
			for (let n = 0; n < MAX_UPCOMING_CLOSURES; n++) {
				await hours.addClosure(
					tenant,
					{ startsOn: inDays(3), endsOn: inDays(3), note: null },
					today(),
				);
			}
		});

		const response = await postClosed(client, owner, tenant, {
			closedFrom: inDays(8),
		});

		assertValidationError(
			response,
			"closedFrom",
			"You can list up to 20 closed days ahead. Remove one to add another.",
		);
		assert.lengthOf(
			await inTenant(tenant, () => hours.upcomingClosures(tenant, today())),
			MAX_UPCOMING_CLOSURES,
		);
	});

	test("removing deletes the entry; another studio's id is a 404 and deletes nothing", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("know-remove-a");
		const { tenant: other } = await studioWithOwner("know-remove-b");
		const mine = await inTenant(tenant, () =>
			hours.addClosure(
				tenant,
				{ startsOn: inDays(3), endsOn: inDays(3), note: null },
				today(),
			),
		);
		const theirs = await inTenant(other, () =>
			hours.addClosure(
				other,
				{ startsOn: inDays(3), endsOn: inDays(3), note: "theirs" },
				today(),
			),
		);

		const foreign = await send(
			client,
			owner,
			"delete",
			`/t/${tenant.slug}/settings/closed-days/${theirs.id}`,
		);
		const own = await send(
			client,
			owner,
			"delete",
			`/t/${tenant.slug}/settings/closed-days/${mine.id}`,
		);

		foreign.assertStatus(404);
		own.assertStatus(302);
		own.assertHeader("location", `/t/${tenant.slug}/settings/good-to-know`);
		own.assertFlashMessage("success", "Closed days removed.");
		assert.lengthOf(
			await inTenant(tenant, () => hours.upcomingClosures(tenant, today())),
			0,
		);
		assert.lengthOf(
			await inTenant(other, () => hours.upcomingClosures(other, today())),
			1,
		);
	});
});

const COLUMNS: Record<
	string,
	"walkInsText" | "ageRuleText" | "beforeSessionText" | "aftercareText"
> = {
	walkIns: "walkInsText",
	ageRule: "ageRuleText",
	beforeSession: "beforeSessionText",
	aftercare: "aftercareText",
};
const storedText = async (tenant: { id: string }, field: string) =>
	(await reload(tenant))[COLUMNS[field]];

test.group("Settings, Good to know: the texts (TAT-128)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("saving stores them trimmed; an empty box clears one", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("know-texts");

		const first = await putTexts(client, owner, tenant, {
			walkIns: "  Small flash only.  ",
			ageRule: "18 and over.",
			beforeSession: "Eat well.",
			aftercare: "दिनमा दुई पटक सफा गर्नुहोस्।",
		});

		first.assertStatus(302);
		first.assertHeader("location", `/t/${tenant.slug}/settings/good-to-know`);
		first.assertFlashMessage(
			"success",
			"Saved. It can take up to 15 minutes to show on your page.",
		);
		let row = await reload(tenant);
		assert.equal(row.walkInsText, "Small flash only.");
		assert.equal(row.ageRuleText, "18 and over.");
		assert.equal(row.beforeSessionText, "Eat well.");
		assert.equal(row.aftercareText, "दिनमा दुई पटक सफा गर्नुहोस्।");

		await putTexts(client, owner, tenant, {
			...ALL_TEXTS,
			ageRule: "18 and over.",
		});
		row = await reload(tenant);
		assert.isNull(row.walkInsText);
		assert.equal(row.ageRuleText, "18 and over.");
		assert.isNull(row.beforeSessionText);
		assert.isNull(row.aftercareText);
	});

	test("saving the texts leaves the deposit policy and the profile alone", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("know-texts-alone");
		await inTenant(tenant, async () => {
			tenant.merge({ depositPolicy: "Deposits hold your date." });
			await tenant.save();
		});

		await putTexts(client, owner, tenant, {
			...ALL_TEXTS,
			walkIns: "Walk in.",
		});

		const row = await reload(tenant);
		assert.equal(row.depositPolicy, "Deposits hold your date.");
		assert.equal(row.name, tenant.name);
	});

	test("a text over its limit is a field error and nothing changes", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("know-texts-long");
		const limits: [string, number][] = [
			["walkIns", 300],
			["ageRule", 200],
			["beforeSession", 2000],
			["aftercare", 2000],
		];

		for (const [field, limit] of limits) {
			const refused = await putTexts(client, owner, tenant, {
				...ALL_TEXTS,
				[field]: "x".repeat(limit + 1),
			});
			// In the form's words: short, kind, no field name.
			assertValidationError(
				refused,
				field,
				`Keep it to ${limit} characters or fewer.`,
			);
			assert.isNull(await storedText(tenant, field));

			const kept = await putTexts(client, owner, tenant, {
				...ALL_TEXTS,
				[field]: "x".repeat(limit),
			});
			kept.assertStatus(302);
			assert.lengthOf((await storedText(tenant, field)) ?? "", limit);
		}
	});
});

test.group("Settings, Good to know: roles (TAT-128)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an artist gets a 404 on every Good to know route and nothing changes", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner("know-roles");
		const artist = await artistIn(tenant, "artist@know-roles.example");
		const closure = await inTenant(tenant, () =>
			hours.addClosure(
				tenant,
				{ startsOn: inDays(3), endsOn: inDays(3), note: null },
				today(),
			),
		);

		(await page(client, artist, tenant)).assertStatus(404);
		for (const response of [
			await putTexts(client, artist, tenant, { ...ALL_TEXTS, walkIns: "x" }),
			await putHours(client, artist, tenant, {
				"hours[sun][open]": "1",
				"hours[sun][opens]": "10:00",
				"hours[sun][closes]": "18:00",
			}),
			await postClosed(client, artist, tenant, { closedFrom: inDays(9) }),
			await send(
				client,
				artist,
				"delete",
				`/t/${tenant.slug}/settings/closed-days/${closure.id}`,
			),
		]) {
			response.assertStatus(404);
		}
		assert.isNull((await reload(tenant)).walkInsText);
		assert.deepEqual(await inTenant(tenant, () => hours.week(tenant)), []);
		assert.lengthOf(
			await inTenant(tenant, () => hours.upcomingClosures(tenant, today())),
			1,
		);
	});
});
