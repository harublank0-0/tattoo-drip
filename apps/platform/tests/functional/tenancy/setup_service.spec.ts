import app from "@adonisjs/core/services/app";
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import ImageService from "#modules/media/services/image_service";
import PaymentMethodService from "#modules/payments/services/payment_method_service";
import SetupService from "#modules/tenancy/services/setup_service";
import TenancyService from "#modules/tenancy/services/tenancy_service";
import { addArtist } from "#tests/helpers/artists";
import { makeClient, makeInquiry } from "#tests/helpers/pipeline";
import { inTenant, studioWithOwner, twoStudios } from "#tests/helpers/tenants";

const methods = new PaymentMethodService(new ImageService());

/** The checklist as a request sees it: the container wires the services. */
const checklistOf = (tenant: Parameters<SetupService["checklist"]>[0]) =>
	inTenant(tenant, async () =>
		(await app.container.make(SetupService)).checklist(tenant),
	);

const ticks = (list: Awaited<ReturnType<SetupService["checklist"]>>) =>
	Object.fromEntries(list.steps.map(({ key, done }) => [key, done]));

const ESEWA = {
	kind: "esewa",
	label: "eSewa",
	accountNumber: "9801234567",
	accountName: "Ink",
} as const;

test.group("SetupService (TAT-101)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a studio just created has nothing ticked", async ({ assert }) => {
		const { tenant } = await studioWithOwner("fresh-ink", "Fresh Ink");

		const list = await checklistOf(tenant);

		assert.deepEqual(ticks(list), {
			artists: false,
			payments: false,
			policy: false,
			inquiry: false,
		});
		assert.equal(list.steps.find(({ next }) => next)?.key, "artists");
	});

	test("an independent artist starts with their own profile, so the first step is done", async ({
		assert,
	}) => {
		const { owner } = await studioWithOwner("solo-owner", "Solo Owner");
		const solo = await new TenancyService().createTenant(owner, {
			type: "independent",
			name: "Solo Artist",
			slug: "solo-artist",
			timezone: "Asia/Kathmandu",
		});

		const list = await checklistOf(solo);

		assert.isTrue(ticks(list).artists);
		assert.equal(list.steps.find(({ next }) => next)?.key, "payments");
	});

	test("adding an artist ticks the first step", async ({ assert }) => {
		const { owner, tenant } = await studioWithOwner("art-ink", "Art Ink");

		await addArtist(tenant, owner);

		const list = await checklistOf(tenant);
		assert.isTrue(ticks(list).artists);
		assert.equal(list.steps.find(({ next }) => next)?.key, "payments");
	});

	test("only a method shown on the deposit page ticks the payments step", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("pay-ink", "Pay Ink");

		// A cash row and a hidden eSewa are not on the deposit page.
		await inTenant(tenant, async () => {
			await methods.create(tenant, { kind: "cash", label: "Cash" });
			await methods.create(tenant, { ...ESEWA, showOnDepositPage: false });
		});
		assert.isFalse(ticks(await checklistOf(tenant)).payments);

		await inTenant(tenant, () =>
			methods.create(tenant, {
				...ESEWA,
				label: "eSewa shown",
				showOnDepositPage: true,
			}),
		);
		assert.isTrue(ticks(await checklistOf(tenant)).payments);
	});

	test("a written deposit policy ticks the third step; blank text does not", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("pol-ink", "Pol Ink");
		const tenancy = new TenancyService();

		await inTenant(tenant, () =>
			tenancy.updateDepositSettings(tenant, {
				defaultDepositPercent: null,
				depositPolicy: "   ",
			}),
		);
		assert.isFalse(ticks(await checklistOf(tenant)).policy);

		await inTenant(tenant, () =>
			tenancy.updateDepositSettings(tenant, {
				defaultDepositPercent: 30,
				depositPolicy: "30% holds your date; it is not refundable.",
			}),
		);
		assert.isTrue(ticks(await checklistOf(tenant)).policy);
	});

	test("an inquiry in any status ticks the last step", async ({ assert }) => {
		const { tenant } = await studioWithOwner("inq-ink", "Inq Ink");

		await inTenant(tenant, async () => {
			const customer = await makeClient(tenant);
			await makeInquiry(tenant, customer, {
				status: "declined",
				decidedAt: DateTime.utc(),
			});
		});

		assert.isTrue(ticks(await checklistOf(tenant)).inquiry);
	});

	test("another studio's artists, methods, policy and inquiries tick nothing here", async ({
		assert,
	}) => {
		const { a, b } = await twoStudios();
		const { tenant: empty } = await studioWithOwner("empty-ink", "Empty Ink");

		// Studio B has all four; so has A. The new studio has none, and neither
		// side's rows leak into the other's list.
		await inTenant(b.tenant, () =>
			new TenancyService().updateDepositSettings(b.tenant, {
				defaultDepositPercent: 50,
				depositPolicy: "B's policy",
			}),
		);
		const bList = await checklistOf(b.tenant);
		assert.deepEqual(ticks(bList), {
			artists: true,
			payments: true,
			policy: true,
			inquiry: true,
		});
		assert.deepEqual(ticks(await checklistOf(empty)), {
			artists: false,
			payments: false,
			policy: false,
			inquiry: false,
		});
		// A never wrote a policy: B's must not tick it.
		assert.isFalse(ticks(await checklistOf(a.tenant)).policy);
	});
});
