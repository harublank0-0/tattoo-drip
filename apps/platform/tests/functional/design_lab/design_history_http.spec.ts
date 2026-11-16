import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import { monthOf } from "#modules/design_lab/history";
import { FAILURE_MESSAGES } from "#modules/design_lab/rules";
import { designLabSettings } from "#modules/design_lab/settings";
import env from "#start/env";
import { sampleInputs, seedDesignLab } from "#tests/helpers/design_lab";
import { artistIn, studioWithOwner } from "#tests/helpers/tenants";

async function labStudio(slug: string) {
	const { owner, tenant } = await studioWithOwner(slug, `Studio ${slug}`);
	const artist = await artistIn(tenant, `artist@${slug}.example`);
	const seeded = await seedDesignLab(tenant, artist);
	return { owner, tenant, artist, ...seeded };
}

type Row = {
	status: string;
	reason: string | null;
	reference: string | null;
	thumbnailUrl: string | null;
	person: string;
	project: { id: string; title: string } | null;
};

test.group("Design Lab history page", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.teardown(() => {
		// env.set also writes process.env: leave it as later specs expect.
		env.set("DESIGN_LAB_PROVIDER", undefined as never);
		delete process.env.DESIGN_LAB_PROVIDER;
	});

	test("the owner sees every attempt of the month with its summary", async ({
		client,
		assert,
	}) => {
		const studio = await labStudio("hist-http");
		const page = await client
			.get(`/t/${studio.tenant.slug}/design-lab/history`)
			.loginAs(studio.owner)
			.withInertia();
		page.assertStatus(200);
		page.assertInertiaComponent("design_lab/history");
		assert.equal(page.header("cache-control"), "private, no-store");
		const props = page.inertiaProps;
		const rows = props.rows as Row[];
		assert.sameMembers(
			rows.map((row) => row.status),
			["failed", "done"],
		);
		const failed = rows.find((row) => row.status === "failed");
		const done = rows.find((row) => row.status === "done");
		assert.equal(failed?.reason, FAILURE_MESSAGES.provider_error);
		assert.equal(
			failed?.reference,
			`${studio.designGeneration.id} · attempt 1`,
		);
		assert.isString(done?.thumbnailUrl);
		assert.isNull(done?.reference);
		assert.equal(done?.project?.id, studio.designProject.id);
		assert.equal(done?.person, `artist@hist-http.example`);
		assert.deepEqual(props.counts, {
			used: 1,
			inProgress: 0,
			failed: 1,
			blocked: 0,
		});
		assert.equal(props.limit, designLabSettings().monthlyLimit);
		assert.isNull(props.studio);
		assert.deepEqual(props.months, [monthOf(DateTime.utc())]);
		assert.deepEqual(props.artists, [
			{ id: studio.artist.id, label: "artist@hist-http.example" },
		]);
		// No costs, prompts or the artist's concept text: the rows' own fields
		// (the image's signed URL names its "design_concept" purpose, and the
		// failure messages say "concept").
		const rowText = JSON.stringify(
			rows.map(({ thumbnailUrl: _url, ...row }) => row),
		).toLowerCase();
		for (const hidden of ["credits", "cost", "prompt"]) {
			assert.notInclude(rowText, hidden);
		}
		assert.notInclude(JSON.stringify(props), sampleInputs().concept);
	});

	test("with an artist chosen, the studio-wide line is separate", async ({
		client,
		assert,
	}) => {
		const studio = await labStudio("hist-http-artist");
		const page = await client
			.get(
				`/t/${studio.tenant.slug}/design-lab/history?artist=${studio.artist.id}`,
			)
			.loginAs(studio.owner)
			.withInertia();
		page.assertStatus(200);
		assert.equal(page.inertiaProps.filters.artist, studio.artist.id);
		assert.isNull(page.inertiaProps.limit);
		assert.deepEqual(page.inertiaProps.studio, {
			used: 1,
			limit: designLabSettings().monthlyLimit,
		});
	});

	test("malformed filters fall back to the defaults", async ({
		client,
		assert,
	}) => {
		const studio = await labStudio("hist-http-bad");
		const page = await client
			.get(
				`/t/${studio.tenant.slug}/design-lab/history?month=2026-13&status=nope&page=0&artist=${crypto.randomUUID()}`,
			)
			.loginAs(studio.owner)
			.withInertia();
		page.assertStatus(200);
		assert.deepEqual(page.inertiaProps.filters, {
			month: monthOf(DateTime.utc()),
			artist: null,
			status: null,
		});
		assert.equal(page.inertiaProps.page, 1);
		assert.lengthOf(page.inertiaProps.rows, 2);
	});

	test("a page past the last is empty, with the summary intact", async ({
		client,
		assert,
	}) => {
		const studio = await labStudio("hist-http-far");
		const page = await client
			.get(`/t/${studio.tenant.slug}/design-lab/history?page=99`)
			.loginAs(studio.owner)
			.withInertia();
		page.assertStatus(200);
		assert.lengthOf(page.inertiaProps.rows, 0);
		assert.equal(page.inertiaProps.counts.used, 1);
	});

	test("an artist is refused", async ({ client }) => {
		const studio = await labStudio("hist-http-artist-404");
		const response = await client
			.get(`/t/${studio.tenant.slug}/design-lab/history`)
			.loginAs(studio.artist);
		response.assertStatus(404);
	});

	test("the page is a 404 while the Design Lab is off", async ({ client }) => {
		const studio = await labStudio("hist-http-off");
		env.set("DESIGN_LAB_PROVIDER", "off");
		const response = await client
			.get(`/t/${studio.tenant.slug}/design-lab/history`)
			.loginAs(studio.owner);
		response.assertStatus(404);
	});
});
