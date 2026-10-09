import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import ImageService from "#modules/media/services/image_service";
import PaymentMethod from "#modules/payments/models/payment_method";
import PaymentMethodService from "#modules/payments/services/payment_method_service";
import Tenant from "#modules/tenancy/models/tenant";
import { testImages, uploadOf } from "#tests/helpers/images";
import { artistIn, studioWithOwner } from "#tests/helpers/tenants";
import { assertValidationError } from "#tests/helpers/validation";

const methods = new PaymentMethodService(new ImageService());
const cash = (label: string) => ({ kind: "cash" as const, label });
const labels = (list: PaymentMethod[]) => list.map(({ label }) => label);

test.group("Payments page", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an owner sees the deposit settings and the methods in order", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		await methods.create(tenant, {
			kind: "fonepay",
			label: "Fonepay",
			showOnDepositPage: true,
			qr: await uploadOf(await testImages.png()),
		});
		await methods.create(tenant, cash("Cash"));

		const response = await client
			.get("/t/black-needle/settings/payments")
			.withInertia()
			.loginAs(owner);

		response.assertStatus(200);
		response.assertInertiaComponent("settings/payments");
		const props = response.inertiaProps;
		assert.deepEqual(props.deposits, {
			defaultDepositPercent: null,
			depositPolicy: null,
		});
		assert.deepEqual(
			props.methods.map((method: { label: string }) => method.label),
			["Fonepay", "Cash"],
		);
		assert.isTrue(props.methods[0].showOnDepositPage);
		assert.match(
			new URL(props.methods[0].qrUrl).pathname,
			/^\/uploads\/tenants\//,
		);
		assert.isNull(props.methods[1].qrUrl);
	});

	test("an owner saves the deposit settings", async ({ client, assert }) => {
		const { owner, tenant } = await studioWithOwner();

		const response = await client
			.put("/t/black-needle/settings/deposits")
			.form({ defaultDepositPercent: "30", depositPolicy: "Holds your date." })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		response.assertHeader("location", "/t/black-needle/settings/payments");
		response.assertFlashMessage("success", "Deposit settings saved.");
		const saved = await Tenant.findOrFail(tenant.id);
		assert.equal(saved.defaultDepositPercent, 30);
		assert.equal(saved.depositPolicy, "Holds your date.");
	});

	test("a deposit over 100% comes back as a field error", async ({
		client,
	}) => {
		const { owner } = await studioWithOwner();

		const response = await client
			.put("/t/black-needle/settings/deposits")
			.form({ defaultDepositPercent: "101", depositPolicy: "" })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		assertValidationError(
			response,
			"defaultDepositPercent",
			"Enter a whole number from 0 to 100.",
		);
	});

	test("an owner moves a method up", async ({ client, assert }) => {
		const { owner, tenant } = await studioWithOwner();
		await methods.create(tenant, cash("A"));
		const b = await methods.create(tenant, cash("B"));

		const response = await client
			.post(`/t/black-needle/settings/payments/${b.id}/move`)
			.form({ direction: "up" })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		response.assertHeader("location", "/t/black-needle/settings/payments");
		assert.deepEqual(labels(await methods.list(tenant)), ["B", "A"]);
	});

	test("an owner deletes a method", async ({ client, assert }) => {
		const { owner, tenant } = await studioWithOwner();
		const method = await methods.create(tenant, cash("Cash"));

		const response = await client
			.delete(`/t/black-needle/settings/payments/${method.id}`)
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		response.assertFlashMessage("success", '"Cash" deleted.');
		assert.isEmpty(await methods.list(tenant));
		const deleted = await PaymentMethod.withTrashed()
			.where("id", method.id)
			.firstOrFail();
		assert.isNotNull(deleted.deletedAt);
	});
});

test.group("Payments page access", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an artist gets 404 on every payments route", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const artist = await artistIn(tenant);
		const method = await methods.create(tenant, cash("Cash"));
		const base = "/t/black-needle/settings";

		for (const request of [
			client.get(`${base}/payments`),
			client.put(`${base}/deposits`).form({ defaultDepositPercent: "50" }),
			client
				.post(`${base}/payments/${method.id}/move`)
				.form({ direction: "up" }),
			client.delete(`${base}/payments/${method.id}`),
		]) {
			const response = await request.withCsrfToken().loginAs(artist);
			response.assertStatus(404);
		}
		assert.deepEqual(labels(await methods.list(tenant)), ["Cash"]);
		assert.isNull((await Tenant.findOrFail(tenant.id)).defaultDepositPercent);
	});

	test("another tenant's owner gets 404 on a method, which stays as it was", async ({
		client,
		assert,
	}) => {
		const { tenant: blackNeedle } = await studioWithOwner("black-needle");
		const { owner: redInkOwner } = await studioWithOwner("red-ink", "Red Ink");
		await methods.create(blackNeedle, cash("A"));
		const b = await methods.create(blackNeedle, cash("B"));

		for (const request of [
			client
				.post(`/t/red-ink/settings/payments/${b.id}/move`)
				.form({ direction: "up" }),
			client.delete(`/t/red-ink/settings/payments/${b.id}`),
		]) {
			const response = await request.withCsrfToken().loginAs(redInkOwner);
			response.assertStatus(404);
		}
		assert.deepEqual(labels(await methods.list(blackNeedle)), ["A", "B"]);
	});

	test("a deleted method gets 404", async ({ client }) => {
		const { owner, tenant } = await studioWithOwner();
		const method = await methods.create(tenant, cash("Cash"));
		await methods.delete(tenant, method);

		for (const request of [
			client
				.post(`/t/black-needle/settings/payments/${method.id}/move`)
				.form({ direction: "up" }),
			client.delete(`/t/black-needle/settings/payments/${method.id}`),
		]) {
			const response = await request.withCsrfToken().loginAs(owner);
			response.assertStatus(404);
		}
	});

	test("an id that isn't a UUID gets 404, not a server error", async ({
		client,
	}) => {
		const { owner } = await studioWithOwner();

		const response = await client
			.delete("/t/black-needle/settings/payments/not-a-uuid")
			.withCsrfToken()
			.loginAs(owner);

		response.assertStatus(404);
	});
});
