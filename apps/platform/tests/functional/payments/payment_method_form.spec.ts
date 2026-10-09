import testUtils from "@adonisjs/core/services/test_utils";
import drive from "@adonisjs/drive/services/main";
import { test } from "@japa/runner";
import ImageService from "#modules/media/services/image_service";
import PaymentMethod from "#modules/payments/models/payment_method";
import PaymentMethodService from "#modules/payments/services/payment_method_service";
import { testImages, uploadOf } from "#tests/helpers/images";
import { artistIn, studioWithOwner } from "#tests/helpers/tenants";
import { assertValidationError } from "#tests/helpers/validation";

const methods = new PaymentMethodService(new ImageService());
const base = "/t/black-needle/settings/payments";
const bank = {
	label: "Bank transfer",
	bankName: "Nabil Bank",
	accountName: "Black Needle Pvt. Ltd.",
	accountNumber: "0123456789",
};

test.group("Adding a payment method", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("the form lists the kinds", async ({ client, assert }) => {
		const { owner } = await studioWithOwner();

		const response = await client
			.get(`${base}/new`)
			.withInertia()
			.loginAs(owner);

		response.assertStatus(200);
		response.assertInertiaComponent("settings/payment_method_form");
		assert.deepEqual(response.inertiaProps.kinds, [
			"fonepay",
			"esewa",
			"khalti",
			"bank",
			"cash",
		]);
		assert.isNull(response.inertiaProps.method);
	});

	test("an owner adds Fonepay with a QR code", async ({ client, assert }) => {
		const { owner, tenant } = await studioWithOwner();

		const response = await client
			.post(base)
			.fields({ kind: "fonepay", label: "Fonepay", showOnDepositPage: "on" })
			.file("qr", await testImages.png(), { filename: "qr.png" })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		response.assertHeader("location", base);
		response.assertFlashMessage("success", '"Fonepay" added.');
		const [method] = await methods.list(tenant);
		assert.equal(method.kind, "fonepay");
		assert.isTrue(method.showOnDepositPage);
		assert.isTrue(await drive.use("public").exists(method.qrImageKey ?? ""));
	});

	test("a file that isn't an image comes back as a field error on qr", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();

		const response = await client
			.post(base)
			.fields({ kind: "fonepay", label: "Fonepay" })
			.file("qr", await testImages.gif(), { filename: "qr.png" })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		assertValidationError(response, "qr");
		assert.isEmpty(await methods.list(tenant));
	});

	test("Fonepay without a QR code comes back as a field error", async ({
		client,
	}) => {
		const { owner } = await studioWithOwner();

		const response = await client
			.post(base)
			.fields({ kind: "fonepay", label: "Fonepay" })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		assertValidationError(response, "qr", "Upload your Fonepay QR code.");
	});

	test("a bank without details gets an error on each missing field", async ({
		client,
	}) => {
		const { owner } = await studioWithOwner();

		const response = await client
			.post(base)
			.fields({ kind: "bank", label: "Bank transfer" })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		assertValidationError(response, "bankName", "Enter the bank's name.");
		assertValidationError(response, "accountName");
		assertValidationError(response, "accountNumber");
	});
});

test.group("Editing a payment method", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("the form shows the method", async ({ client, assert }) => {
		const { owner, tenant } = await studioWithOwner();
		const method = await methods.create(tenant, { kind: "bank", ...bank });

		const response = await client
			.get(`${base}/${method.id}/edit`)
			.withInertia()
			.loginAs(owner);

		response.assertStatus(200);
		assert.equal(response.inertiaProps.method.id, method.id);
		assert.equal(response.inertiaProps.method.bankName, "Nabil Bank");
	});

	test("saving without a new upload keeps the QR", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const method = await methods.create(tenant, {
			kind: "fonepay",
			label: "Fonepay",
			qr: await uploadOf(await testImages.png()),
		});

		const response = await client
			.put(`${base}/${method.id}`)
			.fields({ label: "Fonepay (Nabil)" })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		response.assertHeader("location", base);
		const saved = await PaymentMethod.findOrFail(method.id);
		assert.equal(saved.label, "Fonepay (Nabil)");
		assert.equal(saved.qrImageKey, method.qrImageKey);
	});

	test("an owner removes a bank QR", async ({ client, assert }) => {
		const { owner, tenant } = await studioWithOwner();
		const method = await methods.create(tenant, {
			kind: "bank",
			...bank,
			qr: await uploadOf(await testImages.png()),
		});

		await client
			.put(`${base}/${method.id}`)
			.fields({ ...bank, removeQr: "on" })
			.withCsrfToken()
			.loginAs(owner);

		const saved = await PaymentMethod.findOrFail(method.id);
		assert.isNull(saved.qrImageKey);
	});

	test("a kind in the body is ignored", async ({ client, assert }) => {
		const { owner, tenant } = await studioWithOwner();
		const method = await methods.create(tenant, {
			kind: "cash",
			label: "Cash",
		});

		await client
			.put(`${base}/${method.id}`)
			.fields({ label: "Cash", kind: "fonepay" })
			.withCsrfToken()
			.loginAs(owner);

		assert.equal((await PaymentMethod.findOrFail(method.id)).kind, "cash");
	});
});

test.group("Payment method form access", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an artist gets 404 on the add and edit routes", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const artist = await artistIn(tenant);
		const method = await methods.create(tenant, {
			kind: "cash",
			label: "Cash",
		});

		for (const request of [
			client.get(`${base}/new`),
			client.post(base).fields({ kind: "cash", label: "Sneaky" }),
			client.get(`${base}/${method.id}/edit`),
			client.put(`${base}/${method.id}`).fields({ label: "Sneaky" }),
		]) {
			const response = await request.withCsrfToken().loginAs(artist);
			response.assertStatus(404);
		}
		assert.deepEqual(
			(await methods.list(tenant)).map(({ label }) => label),
			["Cash"],
		);
	});

	test("another tenant's owner gets 404 editing a method, which stays as it was", async ({
		client,
		assert,
	}) => {
		const { tenant: blackNeedle } = await studioWithOwner("black-needle");
		const { owner: redInkOwner } = await studioWithOwner("red-ink", "Red Ink");
		const method = await methods.create(blackNeedle, {
			kind: "cash",
			label: "Cash",
		});

		for (const request of [
			client.get(`/t/red-ink/settings/payments/${method.id}/edit`),
			client
				.put(`/t/red-ink/settings/payments/${method.id}`)
				.fields({ label: "Mine" }),
		]) {
			const response = await request.withCsrfToken().loginAs(redInkOwner);
			response.assertStatus(404);
		}
		assert.equal((await PaymentMethod.findOrFail(method.id)).label, "Cash");
	});

	test("a deleted method gets 404 on edit and update", async ({ client }) => {
		const { owner, tenant } = await studioWithOwner();
		const method = await methods.create(tenant, {
			kind: "cash",
			label: "Cash",
		});
		await methods.delete(tenant, method);

		for (const request of [
			client.get(`${base}/${method.id}/edit`),
			client.put(`${base}/${method.id}`).fields({ label: "Back" }),
		]) {
			const response = await request.withCsrfToken().loginAs(owner);
			response.assertStatus(404);
		}
	});
});
