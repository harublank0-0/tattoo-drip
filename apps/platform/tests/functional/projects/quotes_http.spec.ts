import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import Quote from "#modules/projects/models/quote";
import TattooProject, {
	type ProjectStatus,
} from "#modules/projects/models/tattoo_project";
import { expiresAtFor } from "#modules/projects/quotes";
import TenancyService from "#modules/tenancy/services/tenancy_service";
import {
	makeArtist,
	makeClient,
	makeProject,
	makeQuote,
} from "#tests/helpers/pipeline";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";
import { assertValidationError } from "#tests/helpers/validation";

const KTM = "Asia/Kathmandu";
const dayFromNow = (days: number) =>
	DateTime.now().setZone(KTM).plus({ days }).toFormat("yyyy-MM-dd");

const quotesUrl = (id: string) => `/t/black-needle/projects/${id}/quotes`;
const acceptUrl = (id: string) =>
	`/t/black-needle/projects/${id}/quotes/accept`;
const pageUrl = (id: string) => `/t/black-needle/projects/${id}`;

const fixedForm = (over: Record<string, string> = {}) => ({
	kind: "fixed",
	fixedPrice: "15000",
	depositAmount: "3000",
	expiresOn: dayFromNow(7),
	...over,
});

async function projectIn(
	tenant: { id: string },
	status: ProjectStatus = "reviewing",
) {
	return inTenant(tenant, async () =>
		makeProject(tenant, await makeClient(tenant), { status }),
	);
}

const reload = (tenant: { id: string }, project: TattooProject) =>
	inTenant(tenant, () => TattooProject.findOrFail(project.id));

const versions = (tenant: { id: string }, project: TattooProject) =>
	inTenant(tenant, () =>
		Quote.query().where("project_id", project.id).orderBy("version"),
	);

test.group("Issuing a quote", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an owner issues a fixed quote and the project becomes quoted", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const project = await projectIn(tenant);
		const lastDay = dayFromNow(7);

		const response = await client
			.post(quotesUrl(project.id))
			.form(fixedForm({ expiresOn: lastDay }))
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		response.assertHeader("location", pageUrl(project.id));
		response.assertFlashMessage("success", "Quote issued.");
		const [quote] = await versions(tenant, project);
		assert.include(quote.serialize(), {
			version: 1,
			kind: "fixed",
			fixedPrice: 1_500_000,
			depositAmount: 300_000,
		});
		assert.equal(
			quote.expiresAt.toMillis(),
			expiresAtFor(lastDay, KTM).toMillis(),
		);
		assert.equal((await reload(tenant, project)).status, "quoted");
	});

	test("an hourly revision brings an accepted project back to quoted", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const project = await projectIn(tenant, "deposit_pending");
		const shown = await inTenant(tenant, () => makeQuote(tenant, project));

		const response = await client
			.post(quotesUrl(project.id))
			.form({
				baseQuoteId: shown.id,
				kind: "hourly",
				hourlyRate: "3000",
				estimatedHours: "4.5",
				depositAmount: "0",
				expiresOn: dayFromNow(7),
			})
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		response.assertFlashMessage("success", "Quote revised (version 2).");
		const latest = (await versions(tenant, project)).at(-1);
		assert.include(latest?.serialize(), {
			version: 2,
			kind: "hourly",
			hourlyRate: 300_000,
			estimatedMinutes: 270,
			depositAmount: 0,
		});
		assert.equal((await reload(tenant, project)).status, "quoted");
	});

	test("a form that showed an older version is refused and stores nothing", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const project = await projectIn(tenant, "quoted");
		const shown = await inTenant(tenant, async () => {
			const shown = await makeQuote(tenant, project);
			await makeQuote(tenant, project, { version: 2 });
			return shown;
		});

		const response = await client
			.post(quotesUrl(project.id))
			.form(fixedForm({ baseQuoteId: shown.id }))
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		response.assertHeader("location", pageUrl(project.id));
		response.assertFlashMessage(
			"error",
			"The quote changed: check the new version.",
		);
		assert.lengthOf(await versions(tenant, project), 2);
	});

	test("bad input comes back as field errors and stores nothing", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const project = await projectIn(tenant);
		const send = (form: Record<string, string>) =>
			client
				.post(quotesUrl(project.id))
				.form(form)
				.withCsrfToken()
				.loginAs(owner)
				.redirects(0);

		assertValidationError(
			await send(fixedForm({ fixedPrice: "" })),
			"fixedPrice",
			"Enter the price.",
		);
		assertValidationError(
			await send(fixedForm({ depositAmount: "15001" })),
			"depositAmount",
			"The deposit can't be more than the total.",
		);
		assertValidationError(
			await send(fixedForm({ expiresOn: dayFromNow(-1) })),
			"expiresOn",
			"Pick a date from today to a year from now.",
		);
		assertValidationError(
			await send(fixedForm({ fixedPrice: "15,000" })),
			"fixedPrice",
			"Enter whole rupees from 1 to 1,00,00,000.",
		);
		assert.deepEqual(await versions(tenant, project), []);
	});

	test("a booked project cannot be quoted", async ({ client, assert }) => {
		const { owner, tenant } = await studioWithOwner();
		const project = await projectIn(tenant, "booked");

		const response = await client
			.post(quotesUrl(project.id))
			.form(fixedForm())
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		response.assertHeader("location", pageUrl(project.id));
		response.assertFlashMessage(
			"error",
			"This project can no longer be quoted.",
		);
		assert.deepEqual(await versions(tenant, project), []);
	});
});

test.group("Accepting a quote", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("moves the project to deposit_pending", async ({ client, assert }) => {
		const { owner, tenant } = await studioWithOwner();
		const project = await projectIn(tenant, "quoted");
		const quote = await inTenant(tenant, () => makeQuote(tenant, project));

		const response = await client
			.post(acceptUrl(project.id))
			.form({ quoteId: quote.id })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		response.assertHeader("location", pageUrl(project.id));
		response.assertFlashMessage(
			"success",
			"Accepted: waiting for the deposit.",
		);
		assert.equal((await reload(tenant, project)).status, "deposit_pending");
	});

	test("refuses the old version after a revision", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const project = await projectIn(tenant, "quoted");
		const shown = await inTenant(tenant, async () => {
			const shown = await makeQuote(tenant, project);
			await makeQuote(tenant, project, { version: 2 });
			return shown;
		});

		const response = await client
			.post(acceptUrl(project.id))
			.form({ quoteId: shown.id })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		response.assertFlashMessage(
			"error",
			"The quote changed: check the new version.",
		);
		assert.equal((await reload(tenant, project)).status, "quoted");
	});

	test("refuses an expired quote", async ({ client, assert }) => {
		const { owner, tenant } = await studioWithOwner();
		const project = await projectIn(tenant, "quoted");
		const quote = await inTenant(tenant, () =>
			makeQuote(tenant, project, {
				expiresAt: DateTime.utc().minus({ hours: 1 }),
			}),
		);

		const response = await client
			.post(acceptUrl(project.id))
			.form({ quoteId: quote.id })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		response.assertFlashMessage(
			"error",
			"This quote has expired: revise it first.",
		);
		assert.equal((await reload(tenant, project)).status, "quoted");
	});

	test("refuses a project that is not waiting for an answer", async ({
		client,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const project = await projectIn(tenant, "reviewing");
		const quote = await inTenant(tenant, () => makeQuote(tenant, project));

		const response = await client
			.post(acceptUrl(project.id))
			.form({ quoteId: quote.id })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		response.assertFlashMessage(
			"error",
			"This project is not waiting for the client's answer.",
		);
	});
});

test.group("Quotes and artists", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("the assigned artist can quote; another artist gets a 404 on both routes", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const asha = await artistIn(tenant, "asha@example.com");
		const ram = await artistIn(tenant, "ram@example.com");
		const { project, quote } = await inTenant(tenant, async () => {
			const profile = await makeArtist(tenant, "asha");
			profile.userId = asha.id;
			await profile.save();
			const project = await makeProject(tenant, await makeClient(tenant), {
				artistId: profile.id,
				status: "quoted",
			});
			return { project, quote: await makeQuote(tenant, project) };
		});

		const other = await client
			.post(quotesUrl(project.id))
			.form(fixedForm())
			.withCsrfToken()
			.loginAs(ram)
			.redirects(0);
		other.assertStatus(404);
		const otherAccept = await client
			.post(acceptUrl(project.id))
			.form({ quoteId: quote.id })
			.withCsrfToken()
			.loginAs(ram)
			.redirects(0);
		otherAccept.assertStatus(404);
		assert.equal((await reload(tenant, project)).status, "quoted");

		const own = await client
			.post(quotesUrl(project.id))
			.form(fixedForm({ baseQuoteId: quote.id }))
			.withCsrfToken()
			.loginAs(asha)
			.redirects(0);
		own.assertFlashMessage("success", "Quote revised (version 2).");
	});
});

test.group("Quotes and the artist deposit floor (TAT-16)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	const OWNER_ACCEPTS =
		"Only an owner can confirm this quote: its deposit is below what an artist can offer.";

	/** A studio with a default deposit, and the project assigned to its artist Asha. */
	async function studioWith(percent: number | null, status: ProjectStatus) {
		const { owner, tenant } = await studioWithOwner();
		const asha = await artistIn(tenant, "asha@example.com");
		const project = await inTenant(tenant, async () => {
			await new TenancyService().updateDepositSettings(tenant, {
				defaultDepositPercent: percent,
				depositPolicy: null,
			});
			const profile = await makeArtist(tenant, "asha");
			profile.userId = asha.id;
			await profile.save();
			return makeProject(tenant, await makeClient(tenant), {
				artistId: profile.id,
				status,
			});
		});
		return { owner, asha, tenant, project };
	}

	test("a zero deposit needs an owner: the artist gets a field error and nothing is stored", async ({
		client,
		assert,
	}) => {
		const { asha, tenant, project } = await studioWith(null, "reviewing");

		const response = await client
			.post(quotesUrl(project.id))
			.form(fixedForm({ depositAmount: "0" }))
			.withCsrfToken()
			.loginAs(asha)
			.redirects(0);

		assertValidationError(
			response,
			"depositAmount",
			"Enter a deposit. Only an owner can quote without one.",
		);
		assert.lengthOf(await versions(tenant, project), 0);
		assert.equal((await reload(tenant, project)).status, "reviewing");
	});

	test("under the studio's default is refused with the minimum; the minimum passes", async ({
		client,
		assert,
	}) => {
		const { asha, tenant, project } = await studioWith(20, "reviewing");

		const under = await client
			.post(quotesUrl(project.id))
			.form(fixedForm({ depositAmount: "2999" }))
			.withCsrfToken()
			.loginAs(asha)
			.redirects(0);
		assertValidationError(
			under,
			"depositAmount",
			"Enter at least NPR 3,000, your studio's 20% deposit. Only an owner can quote less or no deposit.",
		);
		assert.lengthOf(await versions(tenant, project), 0);

		const ok = await client
			.post(quotesUrl(project.id))
			.form(fixedForm({ depositAmount: "3000" }))
			.withCsrfToken()
			.loginAs(asha)
			.redirects(0);
		ok.assertFlashMessage("success", "Quote issued.");
		assert.lengthOf(await versions(tenant, project), 1);
	});

	test("a 0% default lets an artist quote no deposit: that is the owner's policy", async ({
		client,
		assert,
	}) => {
		const { asha, tenant, project } = await studioWith(0, "reviewing");

		const response = await client
			.post(quotesUrl(project.id))
			.form(fixedForm({ depositAmount: "0" }))
			.withCsrfToken()
			.loginAs(asha)
			.redirects(0);

		response.assertFlashMessage("success", "Quote issued.");
		assert.lengthOf(await versions(tenant, project), 1);
	});

	test("an owner quotes no deposit in the same studio", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, project } = await studioWith(20, "reviewing");

		const response = await client
			.post(quotesUrl(project.id))
			.form(fixedForm({ depositAmount: "0" }))
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		response.assertFlashMessage("success", "Quote issued.");
		const [quote] = await versions(tenant, project);
		assert.equal(quote.depositAmount, 0);
	});

	test("an artist can't mark a zero-deposit quote accepted; the owner can", async ({
		client,
		assert,
	}) => {
		const { owner, asha, tenant, project } = await studioWith(20, "quoted");
		const quote = await inTenant(tenant, () =>
			makeQuote(tenant, project, { depositAmount: 0 }),
		);

		const refused = await client
			.post(acceptUrl(project.id))
			.form({ quoteId: quote.id })
			.withCsrfToken()
			.loginAs(asha)
			.redirects(0);
		refused.assertFlashMessage("error", OWNER_ACCEPTS);
		assert.equal((await reload(tenant, project)).status, "quoted");

		const accepted = await client
			.post(acceptUrl(project.id))
			.form({ quoteId: quote.id })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);
		accepted.assertFlashMessage(
			"success",
			"Accepted: waiting for the deposit.",
		);
		assert.equal((await reload(tenant, project)).status, "deposit_pending");
	});
});

test.group("Setting a direct booking's price", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	const priceUrl = (id: string) => `/t/black-needle/projects/${id}/price`;

	test("an owner sets it once; the second time is refused", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const project = await projectIn(tenant, "booked");
		const post = (fixedPrice: string) =>
			client
				.post(priceUrl(project.id))
				.form({ fixedPrice })
				.withCsrfToken()
				.loginAs(owner)
				.redirects(0);

		const first = await post("8000");
		first.assertHeader("location", pageUrl(project.id));
		first.assertFlashMessage("success", "Price set.");
		const second = await post("9000");
		second.assertFlashMessage(
			"error",
			"This project already has a price, or isn't booked yet.",
		);
		const all = await versions(tenant, project);
		assert.deepEqual(
			all.map(({ fixedPrice }) => fixedPrice),
			[800_000],
		);
	});

	test("a price outside 1 to 1,00,00,000 whole rupees is a field error", async ({
		client,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const project = await projectIn(tenant, "booked");

		for (const fixedPrice of ["0", "12.5", "100000001", ""]) {
			const response = await client
				.post(priceUrl(project.id))
				.form({ fixedPrice })
				.withCsrfToken()
				.loginAs(owner)
				.redirects(0);
			assertValidationError(
				response,
				"fixedPrice",
				"Enter whole rupees from 1 to 1,00,00,000.",
			);
		}
	});
});
