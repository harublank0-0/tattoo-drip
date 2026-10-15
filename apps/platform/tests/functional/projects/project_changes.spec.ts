import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import TattooProject, {
	type ProjectStatus,
} from "#modules/projects/models/tattoo_project";
import ProjectSession from "#modules/scheduling/models/project_session";
import {
	makeArtist,
	makeClient,
	makeProject,
	makeSession,
} from "#tests/helpers/pipeline";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";
import { assertValidationError } from "#tests/helpers/validation";

const url = (id: string, action = "") =>
	`/t/black-needle/projects/${id}${action}`;

async function projectIn(
	tenant: { id: string },
	status: ProjectStatus = "quoted",
) {
	return inTenant(tenant, async () =>
		makeProject(tenant, await makeClient(tenant), { status }),
	);
}

const reload = (tenant: { id: string }, project: TattooProject) =>
	inTenant(tenant, () => TattooProject.findOrFail(project.id));

test.group("Project moves", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an owner puts a quoted project on hold", async ({ client, assert }) => {
		const { owner, tenant } = await studioWithOwner();
		const project = await projectIn(tenant, "quoted");

		const response = await client
			.post(url(project.id, "/moves"))
			.form({ move: "hold" })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		response.assertHeader("location", url(project.id));
		response.assertFlashMessage("success", "Put on hold.");
		assert.equal((await reload(tenant, project)).status, "on_hold");
	});

	test("a move the status doesn't allow is refused, even from a stale page", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const project = await projectIn(tenant, "cancelled");

		const response = await client
			.post(url(project.id, "/moves"))
			.form({ move: "hold" })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		response.assertHeader("location", url(project.id));
		response.assertFlashMessage(
			"error",
			"This project can't make that change in its current status.",
		);
		assert.equal((await reload(tenant, project)).status, "cancelled");
	});

	test("an unknown move is a field error", async ({ client, assert }) => {
		const { owner, tenant } = await studioWithOwner();
		const project = await projectIn(tenant, "quoted");

		const response = await client
			.post(url(project.id, "/moves"))
			.form({ move: "complete" })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		assertValidationError(response, "move");
		assert.equal((await reload(tenant, project)).status, "quoted");
	});

	test("a client withdrawing cancels the project and its sessions", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const project = await projectIn(tenant, "deposit_pending");
		const session = await inTenant(tenant, async () =>
			makeSession(tenant, project, await makeArtist(tenant)),
		);

		const response = await client
			.post(url(project.id, "/moves"))
			.form({ move: "withdraw" })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		response.assertFlashMessage(
			"success",
			"Client withdrew: project cancelled.",
		);
		assert.equal((await reload(tenant, project)).status, "cancelled");
		const live = await inTenant(tenant, () =>
			ProjectSession.findOrFail(session.id),
		);
		assert.equal(live.status, "cancelled");
	});
});

test.group("Project notes, contact and artist", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("notes are saved, cleared, and capped at 4,000 characters", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const project = await projectIn(tenant);
		const send = (notes: string) =>
			client
				.put(url(project.id, "/notes"))
				.form({ notes })
				.withCsrfToken()
				.loginAs(owner)
				.redirects(0);

		const saved = await send("Prefers mornings.");
		saved.assertFlashMessage("success", "Notes saved.");
		assert.equal((await reload(tenant, project)).notes, "Prefers mornings.");

		assertValidationError(
			await send("x".repeat(4001)),
			"notes",
			"Keep notes under 4,000 characters.",
		);
		assert.equal((await reload(tenant, project)).notes, "Prefers mornings.");

		await send("");
		assert.isNull((await reload(tenant, project)).notes);
	});

	test("Mark contacted records the time", async ({ client, assert }) => {
		const { owner, tenant } = await studioWithOwner();
		const project = await projectIn(tenant);
		const before = DateTime.now().minus({ seconds: 1 });

		const response = await client
			.post(url(project.id, "/contacted"))
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		response.assertFlashMessage("success", "Marked as contacted.");
		const at = (await reload(tenant, project)).lastContactedAt;
		assert.isTrue(at !== null && at >= before);
	});

	test("an owner assigns and removes the artist", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const project = await projectIn(tenant);
		const artist = await inTenant(tenant, () => makeArtist(tenant, "asha"));
		const send = (artistId: string) =>
			client
				.put(url(project.id, "/artist"))
				.form({ artistId })
				.withCsrfToken()
				.loginAs(owner)
				.redirects(0);

		(await send(artist.id)).assertFlashMessage("success", "Artist assigned.");
		assert.equal((await reload(tenant, project)).artistId, artist.id);

		(await send("")).assertFlashMessage("success", "Artist removed.");
		assert.isNull((await reload(tenant, project)).artistId);
	});

	test("artists: the assigned one can move and note, but not assign; others get 404s", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const asha = await artistIn(tenant, "asha@example.com");
		const ram = await artistIn(tenant, "ram@example.com");
		const project = await inTenant(tenant, async () => {
			const profile = await makeArtist(tenant, "asha");
			profile.userId = asha.id;
			await profile.save();
			return makeProject(tenant, await makeClient(tenant), {
				artistId: profile.id,
				status: "quoted",
			});
		});

		const hold = await client
			.post(url(project.id, "/moves"))
			.form({ move: "hold" })
			.withCsrfToken()
			.loginAs(asha)
			.redirects(0);
		hold.assertFlashMessage("success", "Put on hold.");

		const assign = await client
			.put(url(project.id, "/artist"))
			.form({ artistId: "" })
			.withCsrfToken()
			.loginAs(asha)
			.redirects(0);
		assign.assertStatus(404);

		for (const [method, action, body] of [
			["post", "/moves", { move: "resume" }],
			["put", "/notes", { notes: "Hi" }],
			["post", "/contacted", {}],
		] as const) {
			const response = await client
				.request(url(project.id, action), method === "post" ? "POST" : "PUT")
				.form(body)
				.withCsrfToken()
				.loginAs(ram)
				.redirects(0);
			response.assertStatus(404);
		}
		const live = await reload(tenant, project);
		assert.equal(live.status, "on_hold");
		assert.isNotNull(live.artistId);
		assert.isNull(live.notes);
	});
});
