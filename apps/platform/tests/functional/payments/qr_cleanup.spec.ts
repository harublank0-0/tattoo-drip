import testUtils from "@adonisjs/core/services/test_utils";
import drive from "@adonisjs/drive/services/main";
import { test } from "@japa/runner";
import ImageService from "#modules/media/services/image_service";
import PaymentMethod from "#modules/payments/models/payment_method";
import PaymentMethodService from "#modules/payments/services/payment_method_service";
import { currentClient, withDbContext } from "#services/db_context";
import { testImages, uploadOf } from "#tests/helpers/images";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

/**
 * ImageService that remembers every key it stored, so a test can check that
 * no stored file is left behind.
 */
class RecordingImageService extends ImageService {
	keys: string[] = [];

	override async store(...args: Parameters<ImageService["store"]>) {
		const stored = await super.store(...args);
		this.keys.push(stored.key);
		return stored;
	}
}

const methods = new PaymentMethodService(new ImageService());
const qr = async () => uploadOf(await testImages.png());
const exists = (key: string) => drive.use("public").exists(key);

/**
 * Runs `work` inside an open request-like transaction in which opening the
 * next level (the savepoint a service's withTransaction needs) fails with
 * "cannot open", as a lost database connection would.
 */
function whereNoSavepointOpens<T>(tenantId: string, work: () => Promise<T>) {
	return withDbContext({ tenantId }, async () => {
		const client = currentClient();
		if (!client) throw new Error("expected an open transaction");
		const original = client.transaction;
		client.transaction = (() =>
			Promise.reject(new Error("cannot open"))) as unknown as typeof original;
		try {
			return await work();
		} finally {
			client.transaction = original;
		}
	});
}

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

	test("create leaves no file behind when its transaction cannot open", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const images = new RecordingImageService();
		const service = new PaymentMethodService(images);

		await assert.rejects(
			async () =>
				whereNoSavepointOpens(tenant.id, async () =>
					service.create(tenant, {
						kind: "fonepay",
						label: "Fonepay",
						qr: await qr(),
					}),
				),
			/cannot open/,
		);

		for (const key of images.keys) {
			assert.isFalse(await exists(key), `${key} was left on the public disk`);
		}
	});

	test("update leaves no new file behind when its transaction cannot open, and keeps the old one", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const images = new RecordingImageService();
		const service = new PaymentMethodService(images);
		const method = await inTenant(tenant, async () =>
			service.create(tenant, {
				kind: "fonepay",
				label: "Fonepay",
				qr: await qr(),
			}),
		);
		const oldKey = method.qrImageKey ?? "";
		images.keys.length = 0;

		await assert.rejects(
			async () =>
				whereNoSavepointOpens(tenant.id, async () =>
					service.update(tenant, method, {
						label: "Fonepay",
						qr: await qr(),
					}),
				),
			/cannot open/,
		);

		for (const key of images.keys) {
			assert.isFalse(await exists(key), `${key} was left on the public disk`);
		}
		assert.isTrue(await exists(oldKey), "the stored QR stays");
	});
});
