import testUtils from "@adonisjs/core/services/test_utils";
import type { ApiClient } from "@japa/api-client";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import type User from "#models/user";
import TattooProject, {
	type ProjectStatus,
} from "#modules/projects/models/tattoo_project";
import ProjectSession from "#modules/scheduling/models/project_session";
import { localDateTime, sessionTimeText } from "#modules/scheduling/times";
import {
	makeArtist,
	makeClient,
	makePayment,
	makeProject,
	makeQuote,
	makeSession,
} from "#tests/helpers/pipeline";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";
import { assertValidationError } from "#tests/helpers/validation";

const SLUG = "schedule-http-85";
const KTM = "Asia/Kathmandu";

const scheduleUrl = (projectId: string) =>
	`/t/${SLUG}/projects/${projectId}/sessions`;
const projectUrl = (projectId: string) => `/t/${SLUG}/projects/${projectId}`;

/** yyyy-MM-dd, `days` from today in Kathmandu, the test studio's timezone. */
const dayFromNow = (days: number) =>
	DateTime.now().setZone(KTM).plus({ days }).toFormat("yyyy-MM-dd");

/** `time` on the day `days` from today in Kathmandu. */
function localAt(days: number, time: string) {
	const instant = localDateTime(dayFromNow(days), time, KTM);
	if (!instant) throw new Error(`${time} doesn't exist in ${days} days`);
	return instant;
}

function post(
	client: ApiClient,
	url: string,
	body: Record<string, unknown>,
	user: User,
) {
	return client.post(url).form(body).withCsrfToken().loginAs(user).redirects(0);
}

/**
 * The studio: Sita (linked to the artist member Asha) and Anu, a client,
 * and Ram, an artist member with no profile.
 */
async function setup() {
	const { owner, tenant } = await studioWithOwner(SLUG, "Schedule HTTP");
	const asha = await artistIn(tenant, "asha@schedule-http-85.example");
	const ram = await artistIn(tenant, "ram@schedule-http-85.example");
	const parts = await inTenant(tenant, async () => {
		const sita = await makeArtist(tenant, "sita");
		sita.userId = asha.id;
		await sita.save();
		return {
			sita,
			anu: await makeArtist(tenant, "anu"),
			customer: await makeClient(tenant),
		};
	});
	return { owner, asha, ram, tenant, ...parts };
}

/** A project of `customer` in `status`, assigned to `artistId`. */
const projectIn = (
	tenant: { id: string },
	customer: Parameters<typeof makeProject>[1],
	status: ProjectStatus,
	artistId: string,
) =>
	inTenant(tenant, () => makeProject(tenant, customer, { status, artistId }));

const sessionsOf = (tenant: { id: string }, projectId: string) =>
	inTenant(tenant, () =>
		ProjectSession.query().where("project_id", projectId).orderBy("starts_at"),
	);

const statusOf = (tenant: { id: string }, id: string) =>
	inTenant(tenant, async () => (await TattooProject.findOrFail(id)).status);

/** The form for a tattoo session with `artistId`, three days from now at 10:00, two hours. */
const tattoo = (artistId: string, over: Record<string, unknown> = {}) => ({
	sessionKind: "tattoo",
	sessionArtistId: artistId,
	date: dayFromNow(3),
	startTime: "10:00",
	hours: "2",
	...over,
});

test.group("Scheduling on a project over HTTP (TAT-85)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a covered deposit books the project as the tattoo session is scheduled", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, customer, sita } = await setup();
		const project = await projectIn(
			tenant,
			customer,
			"deposit_pending",
			sita.id,
		);
		await inTenant(tenant, async () => {
			await makeQuote(tenant, project);
			await makePayment(tenant, project, {
				status: "verified",
				verifiedAt: DateTime.utc(),
				verifiedByUserId: owner.id,
			});
		});

		const response = await post(
			client,
			scheduleUrl(project.id),
			tattoo(sita.id),
			owner,
		);

		response.assertHeader("location", projectUrl(project.id));
		const [session] = await sessionsOf(tenant, project.id);
		assert.equal(
			session.startsAt.setZone(KTM).toFormat("yyyy-MM-dd HH:mm"),
			`${dayFromNow(3)} 10:00`,
		);
		assert.deepEqual([session.kind, session.status], ["tattoo", "scheduled"]);
		response.assertFlashMessage(
			"success",
			`Session scheduled: ${sessionTimeText(session.startsAt, session.endsAt, KTM)}. The project is booked.`,
		);
		assert.equal(await statusOf(tenant, project.id), "booked");
	});

	test("an uncovered deposit leaves the project waiting, and the flash says what is due", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, customer, sita } = await setup();
		const project = await projectIn(
			tenant,
			customer,
			"deposit_pending",
			sita.id,
		);
		await inTenant(tenant, () => makeQuote(tenant, project));

		const response = await post(
			client,
			scheduleUrl(project.id),
			tattoo(sita.id),
			owner,
		);

		const [session] = await sessionsOf(tenant, project.id);
		response.assertFlashMessage(
			"success",
			`Session scheduled: ${sessionTimeText(session.startsAt, session.endsAt, KTM)}. NPR 3,000 of the deposit is still due: the project is booked once it's paid.`,
		);
		assert.equal(await statusOf(tenant, project.id), "deposit_pending");
	});

	test("an artist's flash names what is due too, as it always did", async ({
		client,
	}) => {
		const { asha, tenant, customer, sita } = await setup();
		const project = await projectIn(
			tenant,
			customer,
			"deposit_pending",
			sita.id,
		);
		await inTenant(tenant, () => makeQuote(tenant, project));

		const response = await post(
			client,
			scheduleUrl(project.id),
			tattoo(sita.id),
			asha,
		);

		const [session] = await sessionsOf(tenant, project.id);
		response.assertFlashMessage(
			"success",
			`Session scheduled: ${sessionTimeText(session.startsAt, session.endsAt, KTM)}. NPR 3,000 of the deposit is still due: the project is booked once it's paid.`,
		);
	});

	test("before acceptance a tattoo session holds the date; a consultation adds nothing", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, customer, sita } = await setup();
		const quoted = await projectIn(tenant, customer, "quoted", sita.id);
		await inTenant(tenant, () => makeQuote(tenant, quoted));
		const reviewing = await projectIn(tenant, customer, "reviewing", sita.id);

		const held = await post(
			client,
			scheduleUrl(quoted.id),
			tattoo(sita.id),
			owner,
		);
		const [heldSession] = await sessionsOf(tenant, quoted.id);
		held.assertFlashMessage(
			"success",
			`Session scheduled: ${sessionTimeText(heldSession.startsAt, heldSession.endsAt, KTM)}. It holds the date: the project is booked once the client accepts the quote and the deposit is settled.`,
		);
		assert.equal(await statusOf(tenant, quoted.id), "quoted");

		const consult = await post(
			client,
			scheduleUrl(reviewing.id),
			tattoo(sita.id, {
				sessionKind: "consultation",
				date: dayFromNow(4),
				hours: "1",
			}),
			owner,
		);
		const [consultSession] = await sessionsOf(tenant, reviewing.id);
		consult.assertFlashMessage(
			"success",
			`Session scheduled: ${sessionTimeText(consultSession.startsAt, consultSession.endsAt, KTM)}.`,
		);
		assert.equal(consultSession.kind, "consultation");
	});

	test("an overlap, a past day and an unknown kind are field errors, and nothing is saved", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, customer, sita } = await setup();
		const project = await projectIn(tenant, customer, "booked", sita.id);
		await inTenant(tenant, () =>
			makeSession(tenant, project, sita, {
				startsAt: localAt(4, "10:00"),
				endsAt: localAt(4, "12:00"),
			}),
		);
		const send = (over: Record<string, unknown>) =>
			post(client, scheduleUrl(project.id), tattoo(sita.id, over), owner);

		assertValidationError(
			await send({ date: dayFromNow(4), startTime: "11:00" }),
			"startTime",
			"Sita already has a session at that time. Pick another time.",
		);
		assertValidationError(
			await send({ date: dayFromNow(-1) }),
			"date",
			"Pick a date from today to a year from now.",
		);
		assertValidationError(
			await send({ sessionKind: "flash" }),
			"sessionKind",
			"Choose tattoo, consultation or touch-up.",
		);
		assert.lengthOf(await sessionsOf(tenant, project.id), 1);
	});

	test("another studio's artist and a deleted artist are field errors, and neither studio changes", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, customer, sita, anu } = await setup();
		const { tenant: other } = await studioWithOwner(
			"schedule-other-http-85",
			"Schedule Other",
		);
		const theirs = await inTenant(other, () => makeArtist(other, "sita"));
		const project = await projectIn(tenant, customer, "booked", sita.id);
		await inTenant(tenant, async () => {
			await anu.softDelete();
		});

		for (const artistId of [theirs.id, anu.id]) {
			assertValidationError(
				await post(client, scheduleUrl(project.id), tattoo(artistId), owner),
				"sessionArtistId",
				"Choose an artist from the list.",
			);
		}
		assert.lengthOf(await sessionsOf(tenant, project.id), 0);
		assert.lengthOf(
			await inTenant(other, () =>
				ProjectSession.query().where("tenant_id", other.id),
			),
			0,
		);
	});

	test("a closed or finished project refuses with a flash", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, customer, sita } = await setup();
		for (const [status, message] of [
			["cancelled", "This project is closed: it takes no new sessions."],
			["completed", "This project is finished: it takes no new sessions."],
		] as const) {
			const project = await projectIn(tenant, customer, status, sita.id);
			const response = await post(
				client,
				scheduleUrl(project.id),
				tattoo(sita.id),
				owner,
			);
			response.assertHeader("location", projectUrl(project.id));
			response.assertFlashMessage("error", message);
			assert.lengthOf(await sessionsOf(tenant, project.id), 0, status);
		}
	});

	test("artists schedule with their own profile on their own project only", async ({
		client,
		assert,
	}) => {
		const { tenant, customer, sita, anu, asha, ram } = await setup();
		const mine = await projectIn(tenant, customer, "booked", sita.id);
		const anus = await projectIn(tenant, customer, "booked", anu.id);

		const own = await post(client, scheduleUrl(mine.id), tattoo(sita.id), asha);
		own.assertHeader("location", projectUrl(mine.id));
		assert.lengthOf(await sessionsOf(tenant, mine.id), 1);

		assertValidationError(
			await post(
				client,
				scheduleUrl(mine.id),
				tattoo(anu.id, { date: dayFromNow(5) }),
				asha,
			),
			"sessionArtistId",
			"Choose an artist from the list.",
		);
		(
			await post(client, scheduleUrl(anus.id), tattoo(sita.id), asha)
		).assertStatus(404);
		(
			await post(client, scheduleUrl(mine.id), tattoo(sita.id), ram)
		).assertStatus(404);
		assert.lengthOf(await sessionsOf(tenant, mine.id), 1);
		assert.lengthOf(await sessionsOf(tenant, anus.id), 0);
	});
});
