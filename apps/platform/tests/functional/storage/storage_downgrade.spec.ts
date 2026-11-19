import app from "@adonisjs/core/services/app";
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import StorageMeterService, {
	type StorageUsage,
} from "#modules/storage/services/storage_meter_service";

const GB = 1024 ** 3;

const usage = (usedBytes: number): StorageUsage => ({
	usedBytes,
	byCategory: { portfolio: usedBytes, clients: 0, design_lab: 0 },
	limitBytes: 25 * GB,
});

/**
 * The downgrade preview (the storage meter, step 4): a Studio studio's
 * usage against Solo's 5 GB, from the usage Billing already read.
 */
test.group("Storage: the downgrade preview", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a Studio studio sees whether its files fit Solo's allowance", async ({
		assert,
	}) => {
		const meter = await app.container.make(StorageMeterService);
		assert.deepEqual(await meter.downgradePreview(usage(3 * GB), "studio"), {
			soloText: "5 GB",
			overText: null,
		});
		assert.deepEqual(await meter.downgradePreview(usage(7.5 * GB), "studio"), {
			soloText: "5 GB",
			overText: "2.5 GB",
		});
		// A few bytes over still reads as over, never "0 KB".
		assert.deepEqual(
			await meter.downgradePreview(usage(5 * GB + 10), "studio"),
			{ soloText: "5 GB", overText: "1 KB" },
		);
	});

	test("a Solo studio has nothing to preview", async ({ assert }) => {
		const meter = await app.container.make(StorageMeterService);
		assert.isNull(await meter.downgradePreview(usage(1 * GB), "solo"));
	});
});
