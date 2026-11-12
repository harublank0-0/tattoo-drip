import { randomBytes, randomUUID } from "node:crypto";
import { test } from "@japa/runner";
import type User from "#models/user";
import InventoryItem from "#modules/inventory/models/inventory_item";
import InventoryLot from "#modules/inventory/models/inventory_lot";
import InventoryMovement from "#modules/inventory/models/inventory_movement";
import InventoryService, {
	InventoryRuleError,
} from "#modules/inventory/services/inventory_service";
import type Tenant from "#modules/tenancy/models/tenant";
import {
	errorOf,
	forgetStudio,
	heldOpen,
	onItsOwnConnection,
	waitUntilBlocked,
} from "#tests/helpers/races";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

/**
 * Real concurrency: two writes to one lot on two connections. Every lot
 * write takes the item's row lock first, so the second waits for the first
 * to commit and then sees its balance. The studios are committed and removed
 * again in the group's teardown.
 */

const service = new InventoryService();
const slugs: string[] = [];

/** A committed studio with a lot-tracked ink holding 5 ml in lot R-1. */
async function stockedLot() {
	const slug = `lot-race-${randomBytes(4).toString("hex")}`;
	slugs.push(slug);
	const { owner, tenant } = await studioWithOwner(slug, "Lot race");
	const { item, lot } = await inTenant(tenant, async () => {
		const ink = await service.create(tenant.id, { name: "Ink", unit: "ml" });
		await service.setTracking(tenant.id, ink.id, "lot");
		await service.record(tenant.id, ink.id, owner.id, {
			requestId: randomUUID(),
			kind: "receive",
			quantity: "5",
			lotNumber: "R-1",
		});
		const received = await InventoryLot.query()
			.where("item_id", ink.id)
			.firstOrFail();
		return { item: ink, lot: received };
	});
	return { owner, tenant, item, lot };
}

const use = (
	tenant: Tenant,
	owner: User,
	itemId: string,
	lotId: string,
	requestId = randomUUID(),
) =>
	service.record(tenant.id, itemId, owner.id, {
		requestId,
		kind: "use",
		quantity: "3",
		lotId,
	});

async function state(tenant: Tenant, itemId: string) {
	return inTenant(tenant, async () => ({
		item: (await InventoryItem.findOrFail(itemId)).quantity,
		lots: (await InventoryLot.query().where("item_id", itemId)).map(
			(lot) => lot.quantity,
		),
		movements: (
			await InventoryMovement.query()
				.where("item_id", itemId)
				.orderBy("created_at")
				.orderBy("id")
		).map((movement) => [movement.kind, movement.lotDelta]),
	}));
}

test.group("Inventory lots under concurrent writes", (group) => {
	group.each.teardown(async () => {
		for (const slug of slugs.splice(0)) await forgetStudio(slug);
	});

	test("two uses of one lot: the second waits, then is refused for the stock the first took", async ({
		assert,
	}) => {
		const { owner, tenant, item, lot } = await stockedLot();
		const first = heldOpen(tenant, () => use(tenant, owner, item.id, lot.id));
		await first.reached;
		const second = await onItsOwnConnection(tenant, () =>
			use(tenant, owner, item.id, lot.id),
		);
		assert.isTrue(await waitUntilBlocked(second.pid, second.outcome));
		first.release();

		assert.isUndefined(errorOf(await first.outcome));
		const refusal = errorOf(await second.outcome);
		assert.instanceOf(refusal, InventoryRuleError);
		assert.equal((refusal as InventoryRuleError).field, "quantity");
		assert.deepEqual(await state(tenant, item.id), {
			item: 2000,
			lots: [2000],
			movements: [
				["receive", 5000],
				["use", -3000],
			],
		});
	});

	test("a retried request racing the original records one movement and returns it to both", async ({
		assert,
	}) => {
		const { owner, tenant, item, lot } = await stockedLot();
		const requestId = randomUUID();
		const first = heldOpen(tenant, () =>
			use(tenant, owner, item.id, lot.id, requestId),
		);
		await first.reached;
		const retry = await onItsOwnConnection(tenant, () =>
			use(tenant, owner, item.id, lot.id, requestId),
		);
		assert.isTrue(await waitUntilBlocked(retry.pid, retry.outcome));
		first.release();

		const original = await first.outcome;
		const repeated = await retry.outcome;
		assert.isTrue("value" in original && "value" in repeated);
		if ("value" in original && "value" in repeated) {
			assert.equal(repeated.value.id, original.value.id);
		}
		assert.deepEqual(await state(tenant, item.id), {
			item: 2000,
			lots: [2000],
			movements: [
				["receive", 5000],
				["use", -3000],
			],
		});
	});

	test("a count and a use of one lot apply one after the other and still add up", async ({
		assert,
	}) => {
		const { owner, tenant, item, lot } = await stockedLot();
		const count = heldOpen(tenant, () =>
			service.record(tenant.id, item.id, owner.id, {
				requestId: randomUUID(),
				kind: "count",
				quantity: "10",
				lotId: lot.id,
			}),
		);
		await count.reached;
		const usage = await onItsOwnConnection(tenant, () =>
			use(tenant, owner, item.id, lot.id),
		);
		assert.isTrue(await waitUntilBlocked(usage.pid, usage.outcome));
		count.release();

		assert.isUndefined(errorOf(await count.outcome));
		assert.isUndefined(errorOf(await usage.outcome));
		assert.deepEqual(await state(tenant, item.id), {
			item: 7000,
			lots: [7000],
			movements: [
				["receive", 5000],
				["count", 5000],
				["use", -3000],
			],
		});
	});
});
