import testUtils from "@adonisjs/core/services/test_utils";
import drive from "@adonisjs/drive/services/main";
import { test } from "@japa/runner";
import ImageService from "#modules/media/services/image_service";
import PaymentMethod from "#modules/payments/models/payment_method";
import PaymentMethodService from "#modules/payments/services/payment_method_service";
import { withDbContext } from "#services/db_context";
import { testImages, uploadOf } from "#tests/helpers/images";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

const methods = new PaymentMethodService(new ImageService());
const qr = async () => uploadOf(await testImages.png());
const exists = (key: string) => drive.use("public").exists(key);

test.group("QR file cleanup follows the real commit", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a QR replaced in a transaction that later fails keeps the old file and drops the new one", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const method = await inTenant(tenant, async () =>
			methods.create(tenant, {
				kind: "fonepay",
				label: "Fonepay",
				qr: await qr(),
			}),
		);
		const oldKey = method.qrImageKey ?? "";
		let newKey = "";

		await assert.rejects(
			() =>
				withDbContext({ tenantId: tenant.id }, async () => {
					const saved = await methods.update(tenant, method, {
						label: "Fonepay",
						qr: await qr(),
					});
					newKey = saved.qrImageKey ?? "";
					assert.notEqual(newKey, oldKey);
					assert.isTrue(await exists(oldKey), "old file is not deleted yet");
					throw new Error("later failure");
				}),
			"later failure",
		);

		assert.isTrue(await exists(oldKey));
		assert.isFalse(await exists(newKey));
		const row = await inTenant(tenant, () =>
			PaymentMethod.findOrFail(method.id),
		);
		assert.equal(row.qrImageKey, oldKey);
	});

	test("the replaced file goes only after the outer transaction commits", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const method = await inTenant(tenant, async () =>
			methods.create(tenant, {
				kind: "fonepay",
				label: "Fonepay",
				qr: await qr(),
			}),
		);
		const oldKey = method.qrImageKey ?? "";

		await withDbContext({ tenantId: tenant.id }, async () => {
			await methods.update(tenant, method, {
				label: "Fonepay",
				qr: await qr(),
			});
			assert.isTrue(await exists(oldKey));
		});

		assert.isFalse(await exists(oldKey));
	});

	test("a new QR stored by create is dropped when the surrounding transaction fails", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		let key = "";

		await assert.rejects(
			() =>
				withDbContext({ tenantId: tenant.id }, async () => {
					const method = await methods.create(tenant, {
						kind: "fonepay",
						label: "Fonepay",
						qr: await qr(),
					});
					key = method.qrImageKey ?? "";
					assert.isTrue(await exists(key));
					throw new Error("later failure");
				}),
			"later failure",
		);

		assert.isFalse(await exists(key));
	});
});
