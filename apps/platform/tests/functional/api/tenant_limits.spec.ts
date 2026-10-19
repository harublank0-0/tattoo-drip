import testUtils from "@adonisjs/core/services/test_utils";
import limiter from "@adonisjs/limiter/services/main";
import { test } from "@japa/runner";
import {
	INTAKE_LIMITS,
	intakeLimitKeys,
} from "#modules/inquiries/intake_limits";
import {
	DEPOSIT_LIMITS,
	depositLimitKeys,
} from "#modules/payments/deposit_limits";
import TenancyService from "#modules/tenancy/services/tenancy_service";
import { apiLimitFor } from "#services/api_limits";
import { assertApiError } from "#tests/helpers/api";
import { fillApiLimit, testServerKeys } from "#tests/helpers/api_limits";
import {
	depositPath,
	depositReady,
	depositServices,
	OWNER,
} from "#tests/helpers/deposits";
import { intakeFields, postInquiry } from "#tests/helpers/intake";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

const A = "tenant-a-38";
const B = "tenant-b-38";
const [ONE] = testServerKeys();
const ANON = { kind: "anonymous", ip: "203.0.113.70" } as const;
const STOREFRONT = { kind: "storefront", ip: "203.0.113.71" } as const;

test.group("Public API limits: per studio", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("anonymous reads of one studio don't touch another's, or the pages' bucket", async ({
		client,
	}) => {
		const { tenant } = await studioWithOwner(A);
		await studioWithOwner(B);
		await fillApiLimit("tenantReads", ANON, tenant.id);

		assertApiError(
			await client
				.get(`/api/v1/tenants/${A}/artists`)
				.header("x-forwarded-for", "198.51.100.10"),
			429,
			"rate_limited",
		);
		(
			await client
				.get(`/api/v1/tenants/${B}/artists`)
				.header("x-forwarded-for", "198.51.100.10")
		).assertStatus(200);
		(
			await client
				.get(`/api/v1/tenants/${A}/artists`)
				.header("authorization", `Bearer ${ONE}`)
				.header("x-visitor-ip", "198.51.100.11")
		).assertStatus(200);
	});

	test("the storefront's reads of one studio have their own bucket", async ({
		client,
	}) => {
		const { tenant } = await studioWithOwner(A);
		await studioWithOwner(B);
		await fillApiLimit("tenantReads", STOREFRONT, tenant.id);
		const keyed = (slug: string) =>
			client
				.get(`/api/v1/tenants/${slug}`)
				.header("authorization", `Bearer ${ONE}`)
				.header("x-visitor-ip", "198.51.100.12");

		assertApiError(await keyed(A), 429, "rate_limited");
		(await keyed(B)).assertStatus(200);
		(
			await client
				.get(`/api/v1/tenants/${A}`)
				.header("x-forwarded-for", "198.51.100.13")
		).assertStatus(200);
	});

	test("a read counts once under the studio, an old slug's too; an unknown slug counts under no studio", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner(A);
		await inTenant(tenant, () =>
			new TenancyService().changeSlug(tenant, "tenant-a-new-38"),
		);
		const { key, budget } = apiLimitFor("tenantReads", ANON, tenant.id);

		(
			await client
				.get(`/api/v1/tenants/${A}`)
				.header("x-forwarded-for", ANON.ip)
		).assertStatus(200);
		(
			await client
				.get("/api/v1/tenants/tenant-a-new-38")
				.header("x-forwarded-for", ANON.ip)
		).assertStatus(200);
		assertApiError(
			await client.get("/api/v1/tenants/no-such-studio-td38"),
			404,
			"not_found",
		);

		assert.equal((await limiter.use({ ...budget }).get(key))?.consumed, 2);
	});

	test("writes don't spend the studio's read budget", async ({ client }) => {
		const { tenant } = await studioWithOwner(A);
		await fillApiLimit("tenantReads", ANON, tenant.id);

		(
			await postInquiry(client, A, intakeFields()).header(
				"x-forwarded-for",
				ANON.ip,
			)
		).assertStatus(201);
	});
});

test.group(
	"Public API limits: route throttles count the caller's address",
	(group) => {
		group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
		const services = depositServices();
		const VISITOR = "198.51.100.30";

		test("a keyed deposit read counts under its visitor", async ({
			client,
		}) => {
			const { tenant } = await studioWithOwner(A);
			const ready = await inTenant(tenant, () => depositReady(tenant));
			const { token } = await inTenant(tenant, () =>
				services.links.issue(tenant, OWNER, ready.project),
			);
			const key = depositLimitKeys("read", VISITOR, token).perAddress;
			await limiter
				.use({ ...DEPOSIT_LIMITS.read.perAddress })
				.increment(key, DEPOSIT_LIMITS.read.perAddress.requests);
			const keyed = (visitor: string) =>
				client
					.get(depositPath(A, token))
					.header("authorization", `Bearer ${ONE}`)
					.header("x-visitor-ip", visitor);

			assertApiError(await keyed(VISITOR), 429, "rate_limited");
			(await keyed("198.51.100.31")).assertStatus(200);
		});

		test("a keyed intake counts under its visitor", async ({ client }) => {
			const { tenant } = await studioWithOwner(A);
			const key = intakeLimitKeys(tenant.id, VISITOR).perAddress;
			await limiter
				.use({ ...INTAKE_LIMITS.perAddress })
				.increment(key, INTAKE_LIMITS.perAddress.requests);
			const keyed = (visitor: string) =>
				postInquiry(client, A, intakeFields())
					.header("authorization", `Bearer ${ONE}`)
					.header("x-visitor-ip", visitor);

			assertApiError(await keyed(VISITOR), 429, "rate_limited");
			(await keyed("198.51.100.32")).assertStatus(201);
		});
	},
);
