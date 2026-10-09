import testUtils from "@adonisjs/core/services/test_utils";
import drive from "@adonisjs/drive/services/main";
import { test } from "@japa/runner";
import ImageService from "#modules/media/services/image_service";
import { PaymentMethodRuleError } from "#modules/payments/errors";
import PaymentMethod from "#modules/payments/models/payment_method";
import PaymentMethodService from "#modules/payments/services/payment_method_service";
import { testImages, uploadOf } from "#tests/helpers/images";
import { studioWithOwner } from "#tests/helpers/tenants";

/**
 * ImageService that remembers every key it stored, so a test can check
 * that a file from a failed save was removed.
 */
class RecordingImageService extends ImageService {
	keys: string[] = [];

	override async store(...args: Parameters<ImageService["store"]>) {
		const stored = await super.store(...args);
		this.keys.push(stored.key);
		return stored;
	}
}

function makeService() {
	const images = new RecordingImageService();
	return { images, methods: new PaymentMethodService(images) };
}

const qr = async () => uploadOf(await testImages.png());
const exists = (key: string) => drive.use("public").exists(key);

async function violationsOf(work: () => Promise<unknown>) {
	try {
		await work();
	} catch (error) {
		if (error instanceof PaymentMethodRuleError) {
			return error.violations.map(({ field }) => field);
		}
		throw error;
	}
	throw new Error("expected a PaymentMethodRuleError");
}

const labels = (methods: PaymentMethod[]) => methods.map(({ label }) => label);

test.group("PaymentMethodService files", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("create stores the QR on the public disk and keeps its key", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const { methods } = makeService();

		const method = await methods.create(tenant, {
			kind: "fonepay",
			label: "Fonepay",
			qr: await qr(),
		});

		assert.match(
			method.qrImageKey ?? "",
			new RegExp(`^tenants/${tenant.id}/payment_qr/`),
		);
		assert.isTrue(await exists(method.qrImageKey ?? ""));
		assert.equal(method.position, 0);
		assert.isFalse(method.showOnDepositPage);
	});

	test("update of a method deleted meanwhile is a 404 and drops the new QR", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const { images, methods } = makeService();
		const method = await methods.create(tenant, {
			kind: "cash",
			label: "Cash",
		});
		const stale = await methods.findFor(tenant, method.id);
		await methods.delete(tenant, method);

		await assert.rejects(() =>
			methods.update(tenant, stale, { label: "Cash 2" }),
		);
		assert.isEmpty(images.keys);
		assert.equal(
			(await PaymentMethod.withTrashed().where("id", method.id).firstOrFail())
				.label,
			"Cash",
		);
	});

	test("create checks the rules before storing anything", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const { images, methods } = makeService();

		assert.deepEqual(
			await violationsOf(() =>
				methods.create(tenant, { kind: "fonepay", label: "Fonepay" }),
			),
			["qr"],
		);
		assert.deepEqual(
			await violationsOf(() =>
				methods.create(tenant, {
					kind: "cash",
					label: "Cash",
					showOnDepositPage: true,
				}),
			),
			["showOnDepositPage"],
		);
		assert.isEmpty(images.keys);
	});

	test("a failed create leaves no file behind", async ({ assert }) => {
		const { tenant } = await studioWithOwner();
		const { images, methods } = makeService();
		const upload = await qr();

		// Over the column's 80 characters: Postgres rejects the insert.
		await assert.rejects(() =>
			methods.create(tenant, {
				kind: "fonepay",
				label: "x".repeat(81),
				qr: upload,
			}),
		);

		assert.lengthOf(images.keys, 1);
		assert.isFalse(await exists(images.keys[0]));
	});

	test("only the kind's own details are saved", async ({ assert }) => {
		const { tenant } = await studioWithOwner();
		const { methods } = makeService();

		const method = await methods.create(tenant, {
			kind: "esewa",
			label: "eSewa",
			accountNumber: "9812345678",
			bankName: "Nabil Bank",
		});

		assert.equal(method.accountNumber, "9812345678");
		assert.isNull(method.bankName);
	});

	test("an edit without a new upload keeps the QR", async ({ assert }) => {
		const { tenant } = await studioWithOwner();
		const { methods } = makeService();
		const method = await methods.create(tenant, {
			kind: "fonepay",
			label: "Fonepay",
			qr: await qr(),
		});
		const key = method.qrImageKey ?? "";

		await methods.update(tenant, method, { label: "Fonepay (Nabil)" });

		const saved = await PaymentMethod.findOrFail(method.id);
		assert.equal(saved.label, "Fonepay (Nabil)");
		assert.equal(saved.qrImageKey, key);
		assert.isTrue(await exists(key));
	});

	test("a label edit from a stale form keeps the QR another edit stored", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const { methods } = makeService();
		const method = await methods.create(tenant, {
			kind: "fonepay",
			label: "Fonepay",
			qr: await qr(),
		});
		const stale = await methods.findFor(tenant, method.id);

		await methods.update(tenant, method, { label: "Fonepay", qr: await qr() });
		const replaced =
			(await PaymentMethod.findOrFail(method.id)).qrImageKey ?? "";
		await methods.update(tenant, stale, { label: "Fonepay (Nabil)" });

		const saved = await PaymentMethod.findOrFail(method.id);
		assert.equal(saved.label, "Fonepay (Nabil)");
		assert.equal(saved.qrImageKey, replaced);
		assert.isTrue(await exists(replaced));
	});

	test("replacing a QR deletes the old file", async ({ assert }) => {
		const { tenant } = await studioWithOwner();
		const { methods } = makeService();
		const method = await methods.create(tenant, {
			kind: "fonepay",
			label: "Fonepay",
			qr: await qr(),
		});
		const oldKey = method.qrImageKey ?? "";

		await methods.update(tenant, method, { label: "Fonepay", qr: await qr() });

		const saved = await PaymentMethod.findOrFail(method.id);
		assert.notEqual(saved.qrImageKey, oldKey);
		assert.isTrue(await exists(saved.qrImageKey ?? ""));
		assert.isFalse(await exists(oldKey));
	});

	test("removing a bank QR deletes its file", async ({ assert }) => {
		const { tenant } = await studioWithOwner();
		const { methods } = makeService();
		const bank = {
			label: "Bank transfer",
			bankName: "Nabil Bank",
			accountName: "Black Needle",
			accountNumber: "0123456789",
		};
		const method = await methods.create(tenant, {
			kind: "bank",
			...bank,
			qr: await qr(),
		});
		const key = method.qrImageKey ?? "";

		await methods.update(tenant, method, { ...bank, removeQr: true });

		const saved = await PaymentMethod.findOrFail(method.id);
		assert.isNull(saved.qrImageKey);
		assert.isFalse(await exists(key));
	});

	test("removing a Fonepay QR is refused and keeps the file", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const { methods } = makeService();
		const method = await methods.create(tenant, {
			kind: "fonepay",
			label: "Fonepay",
			qr: await qr(),
		});
		const key = method.qrImageKey ?? "";

		assert.deepEqual(
			await violationsOf(() =>
				methods.update(tenant, method, { label: "Fonepay", removeQr: true }),
			),
			["qr"],
		);

		const saved = await PaymentMethod.findOrFail(method.id);
		assert.equal(saved.qrImageKey, key);
		assert.isTrue(await exists(key));
	});

	test("a failed edit keeps the old QR and removes the new upload", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const { images, methods } = makeService();
		const method = await methods.create(tenant, {
			kind: "fonepay",
			label: "Fonepay",
			qr: await qr(),
		});
		const oldKey = method.qrImageKey ?? "";
		const upload = await qr();

		await assert.rejects(() =>
			methods.update(tenant, method, { label: "x".repeat(81), qr: upload }),
		);

		const newKey = images.keys[1];
		assert.isFalse(await exists(newKey));
		assert.isTrue(await exists(oldKey));
		const saved = await PaymentMethod.findOrFail(method.id);
		assert.equal(saved.qrImageKey, oldKey);
	});

	test("soft delete keeps the file", async ({ assert }) => {
		const { tenant } = await studioWithOwner();
		const { methods } = makeService();
		const method = await methods.create(tenant, {
			kind: "fonepay",
			label: "Fonepay",
			qr: await qr(),
		});

		await methods.delete(tenant, method);

		assert.isNull(await PaymentMethod.find(method.id));
		assert.isTrue(await exists(method.qrImageKey ?? ""));
	});
});

test.group("PaymentMethodService lists and order", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	const cash = (label: string) => ({ kind: "cash" as const, label });

	test("list and findFor only see the tenant's live methods", async ({
		assert,
	}) => {
		const { tenant: blackNeedle } = await studioWithOwner("black-needle");
		const { tenant: redInk } = await studioWithOwner("red-ink", "Red Ink");
		const { methods } = makeService();
		const kept = await methods.create(blackNeedle, cash("Kept"));
		const deleted = await methods.create(blackNeedle, cash("Deleted"));
		const theirs = await methods.create(redInk, cash("Theirs"));
		await methods.delete(blackNeedle, deleted);

		assert.deepEqual(labels(await methods.list(blackNeedle)), ["Kept"]);
		assert.equal((await methods.findFor(blackNeedle, kept.id)).id, kept.id);
		await assert.rejects(() => methods.findFor(blackNeedle, theirs.id));
		await assert.rejects(() => methods.findFor(blackNeedle, deleted.id));
	});

	test("a new method goes last", async ({ assert }) => {
		const { tenant } = await studioWithOwner();
		const { methods } = makeService();

		await methods.create(tenant, cash("A"));
		await methods.create(tenant, cash("B"));
		await methods.create(tenant, cash("C"));

		assert.deepEqual(labels(await methods.list(tenant)), ["A", "B", "C"]);
	});

	test("move swaps with the nearest live neighbour", async ({ assert }) => {
		const { tenant } = await studioWithOwner();
		const { methods } = makeService();
		await methods.create(tenant, cash("A"));
		const b = await methods.create(tenant, cash("B"));
		const c = await methods.create(tenant, cash("C"));
		await methods.delete(tenant, b);

		await methods.move(tenant, c, "up");
		assert.deepEqual(labels(await methods.list(tenant)), ["C", "A"]);

		await methods.move(tenant, await methods.findFor(tenant, c.id), "down");
		assert.deepEqual(labels(await methods.list(tenant)), ["A", "C"]);
	});

	test("moving past either end changes nothing", async ({ assert }) => {
		const { tenant } = await studioWithOwner();
		const { methods } = makeService();
		const a = await methods.create(tenant, cash("A"));
		const b = await methods.create(tenant, cash("B"));

		await methods.move(tenant, a, "up");
		await methods.move(tenant, b, "down");

		assert.deepEqual(labels(await methods.list(tenant)), ["A", "B"]);
	});

	test("methods that share a position still move", async ({ assert }) => {
		const { tenant } = await studioWithOwner();
		const { methods } = makeService();
		await methods.create(tenant, cash("A"));
		const b = await methods.create(tenant, cash("B"));
		// Two adds at the same moment can get the same position.
		await PaymentMethod.query()
			.where("tenant_id", tenant.id)
			.update({ position: 5 });

		await methods.move(tenant, b, "up");

		assert.deepEqual(labels(await methods.list(tenant)), ["B", "A"]);
	});
});
