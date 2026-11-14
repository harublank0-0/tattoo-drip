import app from "@adonisjs/core/services/app";
import testUtils from "@adonisjs/core/services/test_utils";
import type { ApiResponse } from "@japa/api-client";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import Client from "#modules/clients/models/client";
import DesignAsset from "#modules/design_lab/models/design_asset";
import DesignGeneration from "#modules/design_lab/models/design_generation";
import DesignProject from "#modules/design_lab/models/design_project";
import DesignUsageRecord from "#modules/design_lab/models/design_usage_record";
import { DesignProviderError } from "#modules/design_lab/providers/types";
import GenerationRunner from "#modules/design_lab/services/generation_runner";
import ImageService from "#modules/media/services/image_service";
import type Tenant from "#modules/tenancy/models/tenant";
import { dbClient } from "#services/db_context";
import env from "#start/env";
import {
	designProvider,
	designProviders,
	generateForm,
	seedDesignLab,
} from "#tests/helpers/design_lab";
import {
	artistIn,
	inTenant,
	seededStudio,
	studioWithOwner,
} from "#tests/helpers/tenants";

/** A validation error on `field` whose words include `fragment`. */
function assertValidationError(
	response: ApiResponse,
	field: string,
	fragment?: string,
) {
	const errors = (response.flashMessage("inputErrorsBag") ?? {}) as Record<
		string,
		string[] | string
	>;
	response.assert?.property(
		errors,
		field,
		`expected a validation error on "${field}", got ${JSON.stringify(errors)}`,
	);
	if (fragment !== undefined) {
		const words = [errors[field]].flat().join(" ");
		response.assert?.include(words, fragment);
	}
}

/** A studio with its owner and artist, and the artist's seeded design project. */
async function labStudio(slug = "lab-studio") {
	const { owner, tenant } = await studioWithOwner(slug, "Lab Studio");
	const artist = await artistIn(tenant, `artist@${slug}.example`);
	const seeded = await seedDesignLab(tenant, artist);
	return { owner, tenant, artist, ...seeded };
}

const generationsOf = (tenant: Tenant, projectId: string) =>
	inTenant(tenant, () =>
		DesignGeneration.query()
			.where("design_project_id", projectId)
			.orderBy("created_at")
			.orderBy("variant_index"),
	);

const usageOf = (tenant: Tenant, generationId: string) =>
	inTenant(tenant, () =>
		DesignUsageRecord.query()
			.where("generation_id", generationId)
			.orderBy("attempt"),
	);

/**
 * Runs the worker's steps for a generation until it is final (or `max`
 * steps), as the queued RunDesignGenerationJob runs would, without waiting
 * for their delays.
 */
async function drive(tenant: Tenant, generationId: string, max = 10) {
	const runner = await app.container.make(GenerationRunner);
	for (let index = 0; index < max; index++) {
		const row = await inTenant(tenant, () =>
			DesignGeneration.findOrFail(generationId),
		);
		if (["completed", "failed", "moderated"].includes(row.status)) return row;
		await runner.run(tenant, row.id, row.attempt, row.step);
	}
	return inTenant(tenant, () => DesignGeneration.findOrFail(generationId));
}

test.group("AI Design Lab", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.setup(() => {
		designProvider.reset();
		designProviders.off = false;
		return () => {
			designProvider.reset();
			designProviders.off = false;
			// env.set also writes process.env, which child processes of later
			// specs inherit: put the defaults back and leave both unset there.
			env.set("DESIGN_LAB_MONTHLY_LIMIT", 40);
			env.set("DESIGN_LAB_PROVIDER", undefined as never);
			delete process.env.DESIGN_LAB_MONTHLY_LIMIT;
			delete process.env.DESIGN_LAB_PROVIDER;
		};
	});

	test("an artist generates concepts that the worker stores in the studio's media, with no client data in the prompt", async ({
		client,
		assert,
	}) => {
		const studio = await seededStudio("lab-full", "Lab Full");
		const clientRow = await inTenant(studio.tenant, () =>
			Client.findOrFail(studio.project.clientId),
		);
		const base = `/t/${studio.tenant.slug}/design-lab`;

		const created = await client
			.post(base)
			.loginAs(studio.owner)
			.withCsrfToken()
			.redirects(0)
			.form({ title: "Peony sleeve", tattooProjectId: studio.project.id });
		created.assertStatus(302);
		const project = await inTenant(studio.tenant, () =>
			DesignProject.query().where("title", "Peony sleeve").firstOrFail(),
		);
		assert.equal(project.tattooProjectId, studio.project.id);

		const generated = await client
			.post(`${base}/${project.id}/generations`)
			.loginAs(studio.owner)
			.withCsrfToken()
			.redirects(0)
			.form(generateForm({ variations: "2" }));
		generated.assertStatus(302);
		const rows = await generationsOf(studio.tenant, project.id);
		assert.lengthOf(rows, 2);
		assert.deepEqual(
			rows.map((row) => [row.status, row.variantIndex, row.provider]),
			[
				["queued", 0, "fake"],
				["queued", 1, "fake"],
			],
		);
		assert.equal(rows[0].promptVersion, "tattoo-concept-v1");
		assert.equal(
			rows[0].inputs.concept,
			"A koi fish swimming upward through peonies",
		);
		for (const row of rows) {
			const usage = await usageOf(studio.tenant, row.id);
			assert.deepEqual(
				usage.map((record) => record.status),
				["reserved"],
			);
		}

		for (const row of rows) {
			const done = await drive(studio.tenant, row.id);
			assert.equal(done.status, "completed");
		}
		assert.lengthOf(designProvider.submits, 2);
		for (const submit of designProvider.submits) {
			assert.include(submit.prompt, "koi fish");
			assert.notInclude(submit.prompt, clientRow.name);
			assert.notInclude(submit.prompt, "Studio");
			assert.include(submit.prompt, "No human body");
			assert.deepEqual([submit.width, submit.height], [832, 1216]);
		}

		const images = new ImageService();
		for (const row of rows) {
			const asset = await inTenant(studio.tenant, () =>
				DesignAsset.query().where("generation_id", row.id).firstOrFail(),
			);
			assert.match(
				asset.imageKey,
				new RegExp(`^tenants/${studio.tenant.id}/design_concept/`),
			);
			const file = await images.read(
				"design_concept",
				asset.imageKey,
				studio.tenant,
			);
			assert.isAbove(file.bytes.byteLength, 100);
			const usage = await usageOf(studio.tenant, row.id);
			assert.deepEqual(
				usage.map((record) => [record.status, Number(record.actualCredits)]),
				[["settled", 4]],
			);
			const stored = await inTenant(studio.tenant, () =>
				DesignGeneration.findOrFail(row.id),
			);
			// The polling URL is sealed at rest, never stored as is.
			assert.isString(stored.pollingUrlSealed);
			assert.notInclude(stored.pollingUrlSealed ?? "", "fake-provider.test");
		}

		const page = await client
			.get(`${base}/${project.id}`)
			.loginAs(studio.owner)
			.withInertia();
		page.assertStatus(200);
		page.assertInertiaComponent("design_lab/show");
		const props = JSON.stringify(page.inertiaProps);
		assert.notInclude(props, "fake-provider.test");
		assert.notInclude(props, "polling");
		assert.notInclude(props, "Sealed");
		assert.lengthOf(page.inertiaProps.generations, 2);
		assert.isTrue(
			page.inertiaProps.generations.every(
				(generation: { asset: unknown }) => generation.asset !== null,
			),
		);
		assert.include(page.inertiaProps.project.linked.label, clientRow.name);

		const status = await client
			.get(`${base}/${project.id}/status`)
			.loginAs(studio.owner);
		status.assertStatus(200);
		assert.equal(status.header("cache-control"), "private, no-store");
		assert.isFalse(status.body().pending);
		assert.notInclude(JSON.stringify(status.body()), "fake");

		const asset = page.inertiaProps.generations[0].asset;
		const download = await client
			.get(`${base}/assets/${asset.id}/download`)
			.loginAs(studio.owner);
		download.assertStatus(200);
		assert.equal(download.header("content-type"), "image/png");
		assert.match(
			download.header("content-disposition") ?? "",
			/^attachment; filename="peony-sleeve-ai-concept\.png"$/,
		);
		assert.equal(download.header("cache-control"), "private, no-store");
	});

	test("a repeated submit of the same form creates nothing new", async ({
		client,
		assert,
	}) => {
		const studio = await labStudio("lab-replay");
		const url = `/t/${studio.tenant.slug}/design-lab/${studio.designProject.id}/generations`;
		const form = generateForm({ variations: "2" });
		for (let index = 0; index < 2; index++) {
			(
				await client
					.post(url)
					.loginAs(studio.artist)
					.withCsrfToken()
					.redirects(0)
					.form(form)
			).assertStatus(302);
		}
		const rows = await generationsOf(studio.tenant, studio.designProject.id);
		assert.lengthOf(
			rows.filter((row) => row.requestId === form.requestId),
			2,
		);
		const reserved = await inTenant(studio.tenant, () =>
			DesignUsageRecord.query().where("status", "reserved"),
		);
		assert.lengthOf(reserved, 2);
	});

	test("the monthly allowance is enforced on the server and released attempts don't count", async ({
		client,
		assert,
	}) => {
		const studio = await labStudio("lab-allowance");
		// The seed holds one settled generation this month.
		env.set("DESIGN_LAB_MONTHLY_LIMIT", 2);
		const url = `/t/${studio.tenant.slug}/design-lab/${studio.designProject.id}/generations`;
		const send = (form: Record<string, unknown>) =>
			client
				.post(url)
				.loginAs(studio.artist)
				.withCsrfToken()
				.redirects(0)
				.form(form);

		const tooMany = await send(generateForm({ variations: "2" }));
		tooMany.assertStatus(302);
		assertValidationError(tooMany, "variations", "1 of 2 generations left");
		assert.lengthOf(
			await generationsOf(studio.tenant, studio.designProject.id),
			2,
		);

		(await send(generateForm())).assertStatus(302);
		const full = await send(generateForm());
		assertValidationError(full, "variations", "used all 2 generations");

		// A moderated request gives its unit back.
		const queued = (
			await generationsOf(studio.tenant, studio.designProject.id)
		).find((row) => row.status === "queued");
		assert.exists(queued);
		designProvider.nextPolls.push({
			state: "moderated",
			code: "content_moderated",
		});
		const moderated = await drive(studio.tenant, queued?.id ?? "");
		assert.equal(moderated.status, "moderated");
		assert.equal(moderated.failureCode, "content_moderated");
		assert.deepEqual(
			(await usageOf(studio.tenant, moderated.id)).map((row) => [
				row.status,
				row.releaseReason,
			]),
			[["released", "content_moderated"]],
		);
		(await send(generateForm())).assertStatus(302);
		assert.lengthOf(
			(await generationsOf(studio.tenant, studio.designProject.id)).filter(
				(row) => row.status === "queued",
			),
			1,
		);

		// A count or limit in the form is ignored, and a variation count over
		// the setting is refused.
		env.set("DESIGN_LAB_MONTHLY_LIMIT", 40);
		const over = await send(generateForm({ variations: "4", limit: "999" }));
		assertValidationError(over, "variations", "at most 2 variations");
	});

	test("a moderated generation can't be retried; a failed one retries once per attempt with a new reservation", async ({
		client,
		assert,
	}) => {
		const studio = await labStudio("lab-retry");
		const retryUrl = (id: string) =>
			`/t/${studio.tenant.slug}/design-lab/generations/${id}/retry`;
		const retry = (id: string, attempt: number) =>
			client
				.post(retryUrl(id))
				.loginAs(studio.artist)
				.withCsrfToken()
				.redirects(0)
				.form({ attempt: String(attempt) });

		// The seeded failed generation (attempt 1): two clicks, one retry.
		(await retry(studio.designGeneration.id, 1)).assertStatus(302);
		(await retry(studio.designGeneration.id, 1)).assertStatus(302);
		const retried = await inTenant(studio.tenant, () =>
			DesignGeneration.findOrFail(studio.designGeneration.id),
		);
		assert.equal(retried.attempt, 2);
		assert.equal(retried.status, "queued");
		assert.isNull(retried.failureCode);
		assert.deepEqual(
			(await usageOf(studio.tenant, retried.id)).map((row) => [
				row.attempt,
				row.status,
			]),
			[
				[1, "released"],
				[2, "reserved"],
			],
		);
		const done = await drive(studio.tenant, retried.id);
		assert.equal(done.status, "completed");
		assert.lengthOf(designProvider.submits, 1);

		// A completed generation is not retryable either.
		const again = await retry(studio.designGeneration.id, 2);
		assertValidationError(again, "attempt", "can't be retried");

		// Moderation is final.
		designProvider.nextSubmits.push(
			new DesignProviderError("rejected", "refused", 422),
		);
		(
			await client
				.post(
					`/t/${studio.tenant.slug}/design-lab/${studio.designProject.id}/generations`,
				)
				.loginAs(studio.artist)
				.withCsrfToken()
				.redirects(0)
				.form(generateForm())
		).assertStatus(302);
		const rejected = (
			await generationsOf(studio.tenant, studio.designProject.id)
		).find((row) => row.status === "queued");
		const ended = await drive(studio.tenant, rejected?.id ?? "");
		assert.equal(ended.failureCode, "provider_rejected");
		assertValidationError(
			await retry(ended.id, 1),
			"attempt",
			"can't be retried",
		);
	});

	test("a submit with an unknown outcome is never sent again", async ({
		assert,
	}) => {
		const studio = await labStudio("lab-uncertain");
		const runner = await app.container.make(GenerationRunner);
		const lab = await inTenant(studio.tenant, async () => {
			const row = await DesignGeneration.create({
				tenantId: studio.tenant.id,
				designProjectId: studio.designProject.id,
				createdBy: studio.artist.id,
				requestId: crypto.randomUUID(),
				variantIndex: 0,
				provider: "fake",
				model: "fake-model-1",
				promptVersion: "tattoo-concept-v1",
				inputs: studio.designGeneration.inputs,
				status: "queued",
				attempt: 1,
				step: 0,
				acceptedAt: DateTime.now(),
			});
			await DesignUsageRecord.create({
				tenantId: studio.tenant.id,
				generationId: row.id,
				attempt: 1,
				userId: studio.artist.id,
				provider: "fake",
				model: "fake-model-1",
				units: 1,
				status: "reserved",
				reservedAt: DateTime.now(),
			});
			return row;
		});
		// A timed-out submit: unknown, so failed and never resubmitted.
		designProvider.nextSubmits.push(
			new DesignProviderError("uncertain", "no answer"),
		);
		await runner.run(studio.tenant, lab.id, 1, 0);
		const failed = await inTenant(studio.tenant, () =>
			DesignGeneration.findOrFail(lab.id),
		);
		assert.equal(failed.status, "failed");
		assert.equal(failed.failureCode, "submit_unconfirmed");
		assert.deepEqual(
			(await usageOf(studio.tenant, lab.id)).map((row) => row.status),
			["released"],
		);
		// Its stale runs do nothing.
		await runner.run(studio.tenant, lab.id, 1, 0);
		await runner.run(studio.tenant, lab.id, 1, 1);
		assert.lengthOf(designProvider.submits, 1);

		// A worker that died mid-submit (claimed, never wrote): the watchdog
		// run finds the submit started and doesn't send it again.
		await inTenant(studio.tenant, () =>
			DesignGeneration.query().where("id", lab.id).update({
				status: "queued",
				failure_code: null,
				finished_at: null,
				attempt: 2,
				step: 7,
				submitted_at: new Date(),
			}),
		);
		await runner.run(studio.tenant, lab.id, 2, 7);
		const watched = await inTenant(studio.tenant, () =>
			DesignGeneration.findOrFail(lab.id),
		);
		assert.equal(watched.failureCode, "submit_unconfirmed");
		assert.lengthOf(designProvider.submits, 1);
	});

	test("a busy provider leaves the generation queued, and a repeated delivery of a step does nothing", async ({
		client,
		assert,
	}) => {
		const studio = await labStudio("lab-busy");
		(
			await client
				.post(
					`/t/${studio.tenant.slug}/design-lab/${studio.designProject.id}/generations`,
				)
				.loginAs(studio.artist)
				.withCsrfToken()
				.redirects(0)
				.form(generateForm())
		).assertStatus(302);
		const [row] = (
			await generationsOf(studio.tenant, studio.designProject.id)
		).filter((generation) => generation.status === "queued");
		const runner = await app.container.make(GenerationRunner);
		designProvider.nextSubmits.push(
			new DesignProviderError("rate_limited", "busy", 429),
		);
		await runner.run(studio.tenant, row.id, 1, 0);
		const waiting = await inTenant(studio.tenant, () =>
			DesignGeneration.findOrFail(row.id),
		);
		assert.equal(waiting.status, "queued");
		assert.isNull(waiting.submittedAt);
		assert.equal(waiting.step, 2);
		// The first run delivered again, and its watchdog: neither acts.
		await runner.run(studio.tenant, row.id, 1, 0);
		await runner.run(studio.tenant, row.id, 1, 1);
		assert.lengthOf(designProvider.submits, 1);

		designProvider.nextPolls.push({
			state: "pending",
			providerStatus: "Pending",
		});
		await runner.run(studio.tenant, row.id, 1, 2);
		const processing = await inTenant(studio.tenant, () =>
			DesignGeneration.findOrFail(row.id),
		);
		assert.equal(processing.status, "processing");
		assert.lengthOf(designProvider.submits, 2);
		const done = await drive(studio.tenant, row.id);
		assert.equal(done.status, "completed");
		assert.lengthOf(designProvider.polls, 2);
	});

	test("a provider error, a lost key and a stuck generation each fail and release the reservation", async ({
		assert,
		client,
	}) => {
		const studio = await labStudio("lab-errors");
		const runner = await app.container.make(GenerationRunner);
		const submit = async () => {
			(
				await client
					.post(
						`/t/${studio.tenant.slug}/design-lab/${studio.designProject.id}/generations`,
					)
					.loginAs(studio.artist)
					.withCsrfToken()
					.redirects(0)
					.form(generateForm())
			).assertStatus(302);
			const rows = await generationsOf(studio.tenant, studio.designProject.id);
			return rows
				.filter((row) => row.status === "queued")
				.at(-1) as DesignGeneration;
		};

		const errored = await submit();
		designProvider.nextPolls.push({ state: "error", providerStatus: "Error" });
		assert.equal(
			(await drive(studio.tenant, errored.id)).failureCode,
			"provider_error",
		);

		const keyless = await submit();
		designProvider.nextSubmits.push(
			new DesignProviderError("auth", "bad key", 401),
		);
		assert.equal(
			(await drive(studio.tenant, keyless.id)).failureCode,
			"provider_unavailable",
		);

		const stuck = await submit();
		await inTenant(studio.tenant, () =>
			DesignGeneration.query()
				.where("id", stuck.id)
				.update({
					updated_at: DateTime.now().minus({ minutes: 45 }).toJSDate(),
				}),
		);
		const { rows: candidates } = await dbClient().rawQuery(
			"select tenant_id, generation_id from public.stuck_design_generation_candidates()",
		);
		assert.deepInclude(candidates, {
			tenant_id: studio.tenant.id,
			generation_id: stuck.id,
		});
		assert.isTrue(await runner.failStuck(studio.tenant, stuck.id));
		assert.isFalse(await runner.failStuck(studio.tenant, stuck.id));

		for (const row of [errored, keyless, stuck]) {
			assert.deepEqual(
				(await usageOf(studio.tenant, row.id)).map((record) => record.status),
				["released"],
			);
		}
		const failed = await inTenant(studio.tenant, () =>
			DesignGeneration.findOrFail(stuck.id),
		);
		assert.equal(failed.failureCode, "timed_out");
	});

	test("a burst of generations and a month of refused ones are both bounded", async ({
		client,
		assert,
	}) => {
		const studio = await labStudio("lab-bursts");
		const url = `/t/${studio.tenant.slug}/design-lab/${studio.designProject.id}/generations`;
		const send = (form: Record<string, unknown>) =>
			client
				.post(url)
				.loginAs(studio.artist)
				.withCsrfToken()
				.redirects(0)
				.form(form);
		// The seed's two attempts count toward the 10-minute window too.
		for (let index = 0; index < 5; index++) {
			(await send(generateForm({ variations: "2" }))).assertStatus(302);
		}
		const burst = await send(generateForm());
		assertValidationError(burst, "variations", "last 10 minutes");
		assert.lengthOf(
			await generationsOf(studio.tenant, studio.designProject.id),
			12,
		);

		// Refused attempts are capped too (RELEASED_CAP while the limit is lower).
		const other = await labStudio("lab-released");
		const send2 = (form: Record<string, unknown>) =>
			client
				.post(
					`/t/${other.tenant.slug}/design-lab/${other.designProject.id}/generations`,
				)
				.loginAs(other.owner)
				.withCsrfToken()
				.redirects(0)
				.form(form);
		// The seed holds one released attempt; nine more make ten.
		await inTenant(other.tenant, async () => {
			for (let attempt = 2; attempt <= 10; attempt++) {
				await DesignUsageRecord.create({
					tenantId: other.tenant.id,
					generationId: other.designGeneration.id,
					attempt,
					userId: other.artist.id,
					provider: "fake",
					model: "fake-model-1",
					units: 1,
					status: "released",
					releaseReason: "content_moderated",
					reservedAt: DateTime.utc(),
					releasedAt: DateTime.utc(),
				});
			}
		});
		env.set("DESIGN_LAB_MONTHLY_LIMIT", 5);
		const declined = await send2(generateForm());
		assertValidationError(declined, "variations", "failed or were declined");
	});

	test("contact details in the artist's text are refused before anything is queued", async ({
		client,
		assert,
	}) => {
		const studio = await labStudio("lab-privacy");
		const url = `/t/${studio.tenant.slug}/design-lab/${studio.designProject.id}/generations`;
		const cases: [Record<string, string>, string, string][] = [
			[{ concept: "Rose for maya@example.com" }, "concept", "email address"],
			[
				{ concept: "Call 9801234567 about this rose" },
				"concept",
				"phone number",
			],
			[{ subject: "see https://example.com/ref" }, "subject", "link"],
			[{ concept: "A rose for @maya.ink" }, "concept", "social media handle"],
		];
		for (const [fields, field, message] of cases) {
			const response = await client
				.post(url)
				.loginAs(studio.artist)
				.withCsrfToken()
				.redirects(0)
				.form(generateForm(fields));
			assertValidationError(response, field, message);
		}
		assert.lengthOf(
			await generationsOf(studio.tenant, studio.designProject.id),
			2,
		);
		assert.lengthOf(designProvider.submits, 0);
	});

	test("an artist reaches only their own design projects; owners reach every one", async ({
		client,
		assert,
	}) => {
		const studio = await labStudio("lab-roles");
		const other = await artistIn(studio.tenant, "second@lab-roles.example");
		const base = `/t/${studio.tenant.slug}/design-lab`;
		const pages = [
			`${base}/${studio.designProject.id}`,
			`${base}/${studio.designProject.id}/status`,
			`${base}/assets/${studio.designAsset.id}/download`,
		];
		for (const url of pages) {
			(await client.get(url).loginAs(other).withInertia()).assertStatus(404);
			(await client.get(url).loginAs(studio.owner).withInertia()).assertStatus(
				200,
			);
		}
		const list = await client.get(base).loginAs(other).withInertia();
		assert.lengthOf(list.inertiaProps.projects, 0);
		const ownerList = await client
			.get(base)
			.loginAs(studio.owner)
			.withInertia();
		assert.lengthOf(ownerList.inertiaProps.projects, 1);
		(
			await client
				.post(`${base}/generations/${studio.designGeneration.id}/retry`)
				.loginAs(other)
				.withCsrfToken()
				.redirects(0)
				.form({ attempt: "1" })
		).assertStatus(404);

		// A tattoo project the member may not open can't be linked.
		const foreign = await seededStudio("lab-roles-b", "Lab Roles B");
		const refused = await client
			.post(base)
			.loginAs(studio.owner)
			.withCsrfToken()
			.redirects(0)
			.form({ title: "x", tattooProjectId: foreign.project.id });
		assertValidationError(refused, "tattooProjectId");
	});

	test("turned off, the Design Lab is hidden and every route is a 404", async ({
		client,
		assert,
	}) => {
		const studio = await labStudio("lab-off");
		const base = `/t/${studio.tenant.slug}/design-lab`;
		const on = await client.get(base).loginAs(studio.owner).withInertia();
		assert.isTrue(on.inertiaProps.tenant.designLab);
		env.set("DESIGN_LAB_PROVIDER", "off");
		const off = await client.get(base).loginAs(studio.owner).withInertia();
		off.assertStatus(404);
		const today = await client
			.get(`/t/${studio.tenant.slug}/today`)
			.loginAs(studio.owner)
			.withInertia();
		assert.notProperty(today.inertiaProps.tenant, "designLab");
		(
			await client
				.post(`${base}/${studio.designProject.id}/generations`)
				.loginAs(studio.owner)
				.withCsrfToken()
				.redirects(0)
				.form(generateForm())
		).assertStatus(404);
	});

	test("the first generation needs the provider notice acknowledged", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("lab-notice", "Lab Notice");
		const project = await inTenant(tenant, () =>
			DesignProject.create({
				tenantId: tenant.id,
				createdBy: owner.id,
				title: "First",
				reviewState: "exploring",
			}),
		);
		const page = await client
			.get(`/t/${tenant.slug}/design-lab/${project.id}`)
			.loginAs(owner)
			.withInertia();
		assert.isTrue(page.inertiaProps.needsAcknowledgement);
		assert.isNotEmpty(page.inertiaProps.notice.points);
		const refused = await client
			.post(`/t/${tenant.slug}/design-lab/${project.id}/generations`)
			.loginAs(owner)
			.withCsrfToken()
			.redirects(0)
			.form(generateForm({ acknowledged: "" }));
		assertValidationError(refused, "acknowledged");
		assert.lengthOf(await generationsOf(tenant, project.id), 0);
	});

	test("selecting, renaming and archiving keep one preferred concept and block new generations when archived", async ({
		client,
		assert,
	}) => {
		const studio = await labStudio("lab-select");
		const base = `/t/${studio.tenant.slug}/design-lab`;
		(
			await client
				.post(`${base}/assets/${studio.designAsset.id}/select`)
				.loginAs(studio.artist)
				.withCsrfToken()
				.redirects(0)
				.form({ selected: "true" })
		).assertStatus(302);
		(
			await client
				.put(`${base}/assets/${studio.designAsset.id}`)
				.loginAs(studio.artist)
				.withCsrfToken()
				.redirects(0)
				.form({ title: "Koi v2", notes: "Thicker outline on the tail" })
		).assertStatus(302);
		const asset = await inTenant(studio.tenant, () =>
			DesignAsset.findOrFail(studio.designAsset.id),
		);
		assert.isNotNull(asset.selectedAt);
		assert.equal(asset.title, "Koi v2");
		assert.equal(asset.notes, "Thicker outline on the tail");
		const decided = await inTenant(studio.tenant, () =>
			DesignProject.findOrFail(studio.designProject.id),
		);
		assert.equal(decided.reviewState, "decided");

		(
			await client
				.put(`${base}/${studio.designProject.id}`)
				.loginAs(studio.artist)
				.withCsrfToken()
				.redirects(0)
				.form({ title: "Koi sleeve ideas", archived: "true" })
		).assertStatus(302);
		const blocked = await client
			.post(`${base}/${studio.designProject.id}/generations`)
			.loginAs(studio.artist)
			.withCsrfToken()
			.redirects(0)
			.form(generateForm());
		assertValidationError(blocked, "concept", "archived");
		(
			await client
				.put(`${base}/${studio.designProject.id}`)
				.loginAs(studio.artist)
				.withCsrfToken()
				.redirects(0)
				.form({ title: "Koi sleeve ideas", archived: "false" })
		).assertStatus(302);
		const restored = await inTenant(studio.tenant, () =>
			DesignProject.findOrFail(studio.designProject.id),
		);
		assert.equal(restored.reviewState, "decided");
	});
});
