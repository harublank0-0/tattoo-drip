import testUtils from "@adonisjs/core/services/test_utils";
import queue from "@adonisjs/queue/services/main";
import { test } from "@japa/runner";
import { StorageFullError } from "#modules/media/errors";
import { reserveStorage } from "#modules/storage/reservations";
import Tenant from "#modules/tenancy/models/tenant";
import { captureLogs } from "#tests/helpers/logs";
import {
	enforceStorage,
	MB,
	smallStudio,
	unsetStorageEnforcement,
} from "#tests/helpers/storage";
import { inTenant } from "#tests/helpers/tenants";

/** `n` megabytes, in whole bytes. */
const mb = (n: number) => Math.round(n * MB);

/** The alert jobs queued for `tenant`. */
function alertJobs(fake: ReturnType<typeof queue.fake>, tenant: Tenant) {
	return fake
		.getPushedJobs()
		.filter(({ job }) => job.name === "StorageAlertJob")
		.map(({ job }) => job.payload as { tenantId: string })
		.filter(({ tenantId }) => tenantId === tenant.id);
}

const reserve = (tenant: Tenant, bytes: number) =>
	inTenant(tenant, () =>
		reserveStorage({
			tenantId: tenant.id,
			purpose: "artist_work_photo",
			bytes,
			minutes: 15,
		}),
	);

const markerOf = (tenant: Tenant) =>
	inTenant(
		tenant,
		async () => (await Tenant.findOrFail(tenant.id)).storageAlertedAt,
	);

const setMarker = (tenant: Tenant) =>
	inTenant(tenant, () =>
		Tenant.query()
			.where("id", tenant.id)
			.update({ storage_alerted_at: new Date() }),
	);

/**
 * The 95% email, noticed (the storage meter, step 3): an upload's
 * reservation queues StorageAlertJob when usage reaches 95% of a 1 MB test
 * allowance and the studio's marker is unset; under 90% it clears the
 * marker. Only with enforcement on; observe mode logs.
 */
test.group("Storage: noticing 95%", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.teardown(() => {
		queue.restore();
		unsetStorageEnforcement();
	});

	test("a reservation that reaches 95% queues one alert; one that stays under queues none", async ({
		assert,
	}) => {
		const fake = queue.fake();
		enforceStorage(true);
		const under = await smallStudio("alert-under", mb(0.5));
		await reserve(under.tenant, mb(0.1));
		assert.lengthOf(alertJobs(fake, under.tenant), 0);

		const over = await smallStudio("alert-over", mb(0.94));
		await reserve(over.tenant, mb(0.02));
		assert.deepEqual(alertJobs(fake, over.tenant), [
			{ tenantId: over.tenant.id },
		]);
	});

	test("a refused upload at 96% still queues the alert", async ({ assert }) => {
		const fake = queue.fake();
		enforceStorage(true);
		const s = await smallStudio("alert-refused", mb(0.96));

		const error = await reserve(s.tenant, mb(0.1)).catch((e) => e);

		assert.instanceOf(error, StorageFullError);
		assert.lengthOf(alertJobs(fake, s.tenant), 1);
	});

	test("once the marker is set, nothing more is queued; under 90% an upload clears it", async ({
		assert,
	}) => {
		const fake = queue.fake();
		enforceStorage(true);
		const full = await smallStudio("alert-marked", mb(0.96));
		await setMarker(full.tenant);
		await reserve(full.tenant, mb(0.01));
		assert.lengthOf(alertJobs(fake, full.tenant), 0);
		assert.isNotNull(await markerOf(full.tenant));

		const freed = await smallStudio("alert-freed", mb(0.5));
		await setMarker(freed.tenant);
		await reserve(freed.tenant, mb(0.01));
		assert.isNull(await markerOf(freed.tenant));
	});

	test("in observe mode nothing is queued and the crossing is logged", async ({
		assert,
	}) => {
		const fake = queue.fake();
		enforceStorage(false);
		const s = await smallStudio("alert-observe", mb(0.94));
		const logs = captureLogs();
		try {
			await reserve(s.tenant, mb(0.02));
		} finally {
			logs.restore();
		}
		assert.lengthOf(alertJobs(fake, s.tenant), 0);
		assert.isTrue(
			logs
				.everything()
				.some((line) => line.includes("Package rule would email")),
		);
		assert.isNull(await markerOf(s.tenant));
	});
});
