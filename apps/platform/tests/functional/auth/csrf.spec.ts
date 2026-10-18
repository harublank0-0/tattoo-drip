import app from "@adonisjs/core/services/app";
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import Tenant from "#modules/tenancy/models/tenant";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

const SLUG = "csrf-guard-td9";
const PROFILE = `/t/${SLUG}/settings/profile`;
const REFUSED = "Invalid or expired CSRF token";

/** The studio profile form as the browser sends it (studio_profile.spec.ts). */
const form = {
	name: "Renamed Studio",
	timezone: "Asia/Kathmandu",
	intro: "Fine-line and blackwork in Thamel.",
	contactPhone: "98-1234-5678",
	contactEmail: "hello@csrf-guard-td9.example",
	address: "Thamel, Kathmandu",
	instagramUrl: "https://instagram.com/blackneedle",
	facebookUrl: "",
	tiktokUrl: "",
	websiteUrl: "",
};

async function nameOf(tenant: Tenant) {
	return (await inTenant(tenant, () => Tenant.findOrFail(tenant.id))).name;
}

test.group("CSRF on dashboard writes (TAT-9)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a write without a token, or with another session's token, is refused and changes nothing", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner(SLUG, "CSRF Guard");

		const missing = await client
			.put(PROFILE)
			.form(form)
			.loginAs(owner)
			.redirects(0);
		missing.assertStatus(302);
		missing.assertFlashMessage("error", REFUSED);

		// A real token, issued to another visitor's session.
		const elsewhere = (await client.get("/login")).cookie("XSRF-TOKEN")?.value;
		assert.isString(elsewhere);
		const foreign = await client
			.put(PROFILE)
			.form(form)
			.header("x-csrf-token", String(elsewhere))
			.loginAs(owner)
			.redirects(0);
		foreign.assertStatus(302);
		foreign.assertFlashMessage("error", REFUSED);

		assert.equal(await nameOf(tenant), "CSRF Guard");

		// Positive control: the same write with this session's token saves.
		const saved = await client
			.put(PROFILE)
			.form(form)
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);
		saved.assertStatus(302);
		saved.assertHeader("location", PROFILE);
		assert.equal(await nameOf(tenant), "Renamed Studio");
	});

	test("a logout without a token leaves the user signed in", async ({
		client,
	}) => {
		const { owner } = await studioWithOwner(SLUG, "CSRF Guard");

		const response = await client.post("/logout").loginAs(owner).redirects(0);

		response.assertStatus(302);
		response.assertFlashMessage("error", REFUSED);
		response.assertSession("auth_web");
	});

	test("Shield's CSRF stays on for every write, with no exceptions", ({
		assert,
	}) => {
		const csrf = app.config.get<{
			enabled: boolean;
			exceptRoutes: unknown;
			enableXsrfCookie: boolean;
			methods: string[];
			cookieOptions?: Record<string, unknown>;
		}>("shield.csrf");
		assert.isTrue(csrf.enabled);
		assert.deepEqual(csrf.exceptRoutes, []);
		assert.isTrue(csrf.enableXsrfCookie);
		assert.sameMembers(csrf.methods, ["POST", "PUT", "PATCH", "DELETE"]);
		assert.notProperty(csrf.cookieOptions ?? {}, "domain");
	});
});
