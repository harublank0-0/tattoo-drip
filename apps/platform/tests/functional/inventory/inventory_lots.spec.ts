import { randomUUID } from "node:crypto";
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import User from "#models/user";
import InventoryItem from "#modules/inventory/models/inventory_item";
import InventoryLot from "#modules/inventory/models/inventory_lot";
import InventoryMovement from "#modules/inventory/models/inventory_movement";
import InventoryService from "#modules/inventory/services/inventory_service";
import { todayIn } from "#modules/projects/quotes";
import TenantMembership from "#modules/tenancy/models/tenant_membership";
import TenancyService from "#modules/tenancy/services/tenancy_service";
import { withTransaction } from "#services/db_context";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";
import { assertValidationError } from "#tests/helpers/validation";

const service = new InventoryService();

/** A studio in `timezone` with an owner and an artist granted inventory. */
async function studio(slug: string, timezone = "Asia/Kathmandu") {
	const owner = await User.create({
		email: `owner@${slug}.example`,
		password: "secret-password",
	});
	const tenant = await new TenancyService().createTenant(owner, {
		type: "studio",
		name: `Studio ${slug}`,
		slug,
		timezone,
	});
	const artist = await artistIn(tenant, `artist@${slug}.example`);
	await inTenant(tenant, async () => {
		const membership = await TenantMembership.query()
			.where("tenant_id", tenant.id)
			.where("user_id", artist.id)
			.firstOrFail();
		await membership.merge({ inventoryAccess: true }).save();
	});
	return { owner, tenant, artist };
}

const day = (timezone: string, days: number) =>
	DateTime.fromISO(todayIn(timezone), { zone: "utc" })
		.plus({ days })
		.toFormat("yyyy-MM-dd");

/**
 * Lots add up to a tracked item, the item's movements add up to its
 * balance, and each lot's movements add up to the lot's balance.
 */
async function assertReconciles(
	assert: { equal(actual: unknown, expected: unknown, message?: string): void },
	tenant: { id: string },
	itemId: string,
	tracked: boolean,
) {
	await inTenant(tenant, async () => {
		const item = await InventoryItem.query()
			.where("tenant_id", tenant.id)
			.where("id", itemId)
			.firstOrFail();
		const lots = await InventoryLot.query()
			.where("tenant_id", tenant.id)
			.where("item_id", itemId);
		const movements = await InventoryMovement.query()
			.where("tenant_id", tenant.id)
			.where("item_id", itemId);
		const lotSum = lots.reduce((sum, lot) => sum + lot.quantity, 0);
		if (tracked) assert.equal(lotSum, item.quantity, "lots = item");
		assert.equal(
			movements.reduce((sum, movement) => sum + movement.delta, 0),
			item.quantity,
			"item movements = item",
		);
		for (const lot of lots) {
			assert.equal(
				movements
					.filter((movement) => movement.lotId === lot.id)
					.reduce((sum, movement) => sum + (movement.lotDelta ?? 0), 0),
				lot.quantity,
				`movements of lot ${lot.lotNumber} = lot`,
			);
		}
	});
}

test.group("Studio OS inventory lots", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an owner receives by lot, an artist uses the suggested lot, and lots reconcile with the item", async ({
		client,
		assert,
	}) => {
		const zone = "Asia/Kathmandu";
		const { owner, tenant, artist } = await studio("lots-flow", zone);
		const item = await inTenant(tenant, () =>
			service.create(tenant.id, { name: "Black ink", unit: "ml" }),
		);
		const base = `/t/${tenant.slug}/inventory`;
		const detail = `${base}/${item.id}`;
		const post = (user: User, body: Record<string, string>) =>
			client
				.post(`${detail}/movements`)
				.loginAs(user)
				.withCsrfToken()
				.redirects(0)
				.form({ requestId: randomUUID(), ...body });
		const tracking = (user: User, value: string) =>
			client
				.put(`${detail}/tracking`)
				.loginAs(user)
				.withCsrfToken()
				.redirects(0)
				.form({ tracking: value });

		(await tracking(artist, "lot")).assertStatus(404);
		(await tracking(owner, "lot")).assertStatus(302);

		const later = day(zone, 90);
		const soon = day(zone, 10);
		const receipt = {
			requestId: randomUUID(),
			kind: "receive",
			quantity: "10",
			lotNumber: "LOT-B",
			expiresOn: later,
		};
		(await post(owner, receipt)).assertStatus(302);
		// A retry of the same request (the lot now exists) records nothing new.
		(await post(owner, receipt)).assertStatus(302);
		(
			await post(owner, {
				kind: "receive",
				quantity: "5",
				lotNumber: "lot-a",
				expiresOn: soon,
			})
		).assertStatus(302);
		// The same lot number under another expiry is refused, not merged.
		assertValidationError(
			await post(owner, {
				kind: "receive",
				quantity: "1",
				lotNumber: "lot-b",
				expiresOn: soon,
			}),
			"expiresOn",
		);
		// A tracked item's receipt names a lot.
		assertValidationError(
			await post(owner, { kind: "receive", quantity: "1" }),
			"lotNumber",
		);

		const page = await client.get(detail).loginAs(artist).withInertia();
		page.assertStatus(200);
		const props = page.inertiaProps;
		assert.isFalse(props.canManage);
		assert.equal(props.item.tracking, "lot");
		assert.equal(props.item.quantity, 15000);
		assert.equal(props.item.expiry, "soon");
		assert.deepEqual(
			props.lots.map((lot: { number: string; quantity: number }) => [
				lot.number,
				lot.quantity,
			]),
			[
				["lot-a", 5000],
				["LOT-B", 10000],
			],
		);
		const [lotA, lotB] = props.lots;
		assert.equal(lotA.expiry, "soon");
		assert.isNull(lotB.expiry);
		assert.equal(props.suggestedLotId, lotA.id);

		// Receiving into an existing lot by id.
		(
			await post(owner, { kind: "receive", quantity: "2", lotId: lotB.id })
		).assertStatus(302);

		// Staff usage: partial, then more than the lot holds though the item
		// has enough, then without naming a lot.
		(
			await post(artist, { kind: "use", quantity: "2", lotId: lotA.id })
		).assertStatus(302);
		assertValidationError(
			await post(artist, { kind: "use", quantity: "4", lotId: lotA.id }),
			"quantity",
		);
		assertValidationError(
			await post(artist, { kind: "use", quantity: "1" }),
			"lotId",
		);
		for (const kind of ["receive", "count", "assign"]) {
			(
				await post(artist, { kind, quantity: "1", lotId: lotA.id })
			).assertStatus(404);
		}

		// The owner corrects a lot's balance with a count.
		(
			await post(owner, {
				kind: "count",
				quantity: "11.5",
				lotId: lotB.id,
				note: "Shelf count",
			})
		).assertStatus(302);
		assertValidationError(
			await post(owner, { kind: "count", quantity: "11.5", lotId: lotB.id }),
			"quantity",
		);

		const after = await client.get(detail).loginAs(owner).withInertia();
		assert.equal(after.inertiaProps.item.quantity, 14500);
		assert.deepEqual(
			after.inertiaProps.lots.map((lot: { quantity: number }) => lot.quantity),
			[3000, 11500],
		);
		const [count, use, ...rest] = after.inertiaProps.history;
		assert.deepInclude(count, {
			kind: "count",
			delta: -500,
			balanceAfter: 14500,
			note: "Shelf count",
		});
		assert.deepEqual(count.lot, {
			id: lotB.id,
			number: "LOT-B",
			delta: -500,
			balanceAfter: 11500,
		});
		assert.equal(use.lot.number, "lot-a");
		assert.equal(use.actor, "artist@lots-flow.example");
		assert.lengthOf(rest, 3);

		const lotHistory = await client
			.get(`${detail}?lot=${lotB.id}`)
			.loginAs(owner)
			.withInertia();
		assert.equal(lotHistory.inertiaProps.lotFilter.number, "LOT-B");
		assert.deepEqual(
			lotHistory.inertiaProps.history.map(
				(movement: { kind: string }) => movement.kind,
			),
			["count", "receive", "receive"],
		);

		const expiring = await client
			.get(`${base}?status=expiring`)
			.loginAs(artist)
			.withInertia();
		assert.deepEqual(
			expiring.inertiaProps.items.map((row: { id: string; expiry: string }) => [
				row.id,
				row.expiry,
			]),
			[[item.id, "soon"]],
		);
		await assertReconciles(assert, tenant, item.id, true);
	});

	test("existing stock is put into lots before tracking is turned on, keeping the total and history", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, artist } = await studio("lots-setup");
		const item = await inTenant(tenant, async () => {
			const stock = await service.create(tenant.id, {
				name: "Cartridges",
				unit: "box",
			});
			await service.record(tenant.id, stock.id, owner.id, {
				requestId: randomUUID(),
				kind: "receive",
				quantity: "8",
			});
			return stock;
		});
		const detail = `/t/${tenant.slug}/inventory/${item.id}`;
		const post = (user: User, body: Record<string, string>) =>
			client
				.post(`${detail}/movements`)
				.loginAs(user)
				.withCsrfToken()
				.redirects(0)
				.form({ requestId: randomUUID(), ...body });
		const tracking = (value: string) =>
			client
				.put(`${detail}/tracking`)
				.loginAs(owner)
				.withCsrfToken()
				.redirects(0)
				.form({ tracking: value });

		// A standard item takes no lot on its everyday movements.
		assertValidationError(
			await post(owner, { kind: "use", quantity: "1", lotNumber: "L1" }),
			"lotId",
		);
		assertValidationError(await tracking("lot"), "tracking");
		(
			await post(owner, {
				kind: "assign",
				quantity: "5",
				lotNumber: "L1",
				expiresOn: "2027-03-01",
			})
		).assertStatus(302);
		assertValidationError(
			await post(owner, { kind: "assign", quantity: "4", lotNumber: "L2" }),
			"quantity",
		);
		// Stock in a lot waits for tracking: only 3 boxes are outside lots.
		assertValidationError(
			await post(artist, { kind: "use", quantity: "4" }),
			"quantity",
		);
		(await post(artist, { kind: "use", quantity: "1" })).assertStatus(302);

		// A wrong assignment is undone by taking stock back out of the lot.
		const setup = await client.get(detail).loginAs(owner).withInertia();
		assert.equal(setup.inertiaProps.unassigned, 2000);
		assert.equal(setup.inertiaProps.item.tracking, "standard");
		const l1 = setup.inertiaProps.lots[0].id;
		(
			await post(artist, { kind: "release", quantity: "1", lotId: l1 })
		).assertStatus(404);
		assertValidationError(
			await post(owner, { kind: "release", quantity: "6", lotId: l1 }),
			"quantity",
		);
		(
			await post(owner, { kind: "release", quantity: "2", lotId: l1 })
		).assertStatus(302);
		const released = await client.get(detail).loginAs(owner).withInertia();
		assert.equal(released.inertiaProps.unassigned, 4000);
		assert.equal(released.inertiaProps.item.quantity, 7000);

		(
			await post(owner, { kind: "assign", quantity: "4", lotNumber: "L2" })
		).assertStatus(302);
		(await tracking("lot")).assertStatus(302);
		// Not while lots hold stock.
		assertValidationError(await tracking("standard"), "tracking");
		// Once tracking is on, a lot is corrected with a count instead.
		assertValidationError(
			await post(owner, { kind: "release", quantity: "1", lotId: l1 }),
			"kind",
		);

		const page = await client.get(detail).loginAs(owner).withInertia();
		assert.equal(page.inertiaProps.item.quantity, 7000);
		assert.equal(page.inertiaProps.item.tracking, "lot");
		assert.equal(page.inertiaProps.unassigned, 0);
		assert.deepEqual(
			page.inertiaProps.history.map(
				(movement: { kind: string; delta: number }) => [
					movement.kind,
					movement.delta,
				],
			),
			[
				["assign", 0],
				["release", 0],
				["use", -1000],
				["assign", 0],
				["receive", 8000],
			],
		);
		await assertReconciles(assert, tenant, item.id, true);

		// Emptying every lot allows turning tracking off again.
		for (const lot of page.inertiaProps.lots) {
			(
				await post(owner, { kind: "count", quantity: "0", lotId: lot.id })
			).assertStatus(302);
		}
		(await tracking("standard")).assertStatus(302);
		(await post(owner, { kind: "receive", quantity: "3" })).assertStatus(302);
		await assertReconciles(assert, tenant, item.id, false);
	});

	test("standard items keep the single balance and the CSV contract; tracked items export their total", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studio("lots-csv");
		await inTenant(tenant, async () => {
			const tracked = await service.create(tenant.id, {
				name: "Ink",
				unit: "ml",
				sku: "INK-9",
			});
			await service.setTracking(tenant.id, tracked.id, "lot");
			await service.record(tenant.id, tracked.id, owner.id, {
				requestId: randomUUID(),
				kind: "receive",
				quantity: "4.5",
				lotNumber: "A1",
			});
			const standard = await service.create(tenant.id, {
				name: "Gloves",
				unit: "box",
			});
			await service.record(tenant.id, standard.id, owner.id, {
				requestId: randomUUID(),
				kind: "receive",
				quantity: "2",
			});
		});
		const exported = await client
			.get(`/t/${tenant.slug}/inventory/export.csv`)
			.loginAs(owner);
		exported.assertStatus(200);
		assert.equal(
			exported.text(),
			[
				"name,sku,category,unit,quantity,reorder_threshold",
				`"Gloves","","",box,2,`,
				`"Ink","INK-9","",ml,4.5,`,
				"",
			].join("\r\n"),
		);
		const imported = await client
			.post(`/t/${tenant.slug}/inventory/import`)
			.loginAs(owner)
			.withCsrfToken()
			.redirects(0)
			.file(
				"csv",
				Buffer.from(
					"name,sku,category,unit,quantity,reorder_threshold\nNeedles,,,box,3,\n",
				),
				{ filename: "inventory.csv", contentType: "text/csv" },
			);
		imported.assertFlashMessage("success", "Imported 1 inventory item.");
		const catalog = await client
			.get(`/t/${tenant.slug}/inventory?q=Needles`)
			.loginAs(owner)
			.withInertia();
		assert.equal(catalog.inertiaProps.items[0].tracking, "standard");
		assert.equal(catalog.inertiaProps.items[0].quantity, 3000);
	});

	test("expiry is judged by the studio's own date", async ({ assert }) => {
		// Kiritimati (UTC+14) is always a day or two ahead of Pago Pago
		// (UTC-11): a lot that expires on Pago Pago's today is still in date
		// there, and already expired in Kiritimati.
		const expiresOn = todayIn("Pacific/Pago_Pago");
		const flags: Record<string, unknown> = {};
		for (const zone of ["Pacific/Pago_Pago", "Pacific/Kiritimati"]) {
			const { owner, tenant } = await studio(
				`lots-${zone.split("/")[1].toLowerCase().replace("_", "-")}`,
				zone,
			);
			await inTenant(tenant, async () => {
				const item = await service.create(tenant.id, {
					name: "Ink",
					unit: "ml",
				});
				await service.setTracking(tenant.id, item.id, "lot");
				await service.record(tenant.id, item.id, owner.id, {
					requestId: randomUUID(),
					kind: "receive",
					quantity: "1",
					lotNumber: "X",
					expiresOn,
				});
				const found = await service.expiryFlags(
					tenant.id,
					[item.id],
					todayIn(zone),
				);
				flags[zone] = found.get(item.id);
			});
		}
		assert.deepEqual(flags, {
			"Pacific/Pago_Pago": "soon",
			"Pacific/Kiritimati": "expired",
		});
	});

	test("a lot is only reachable through its own studio and item", async ({
		client,
		assert,
	}) => {
		const a = await studioWithOwner("lots-iso-a");
		const b = await studioWithOwner("lots-iso-b");
		const tracked = async (target: typeof a, name: string, lotNumber: string) =>
			inTenant(target.tenant, async () => {
				const item = await service.create(target.tenant.id, {
					name,
					unit: "ml",
				});
				await service.setTracking(target.tenant.id, item.id, "lot");
				await service.record(target.tenant.id, item.id, target.owner.id, {
					requestId: randomUUID(),
					kind: "receive",
					quantity: "5",
					lotNumber,
				});
				const lot = await InventoryLot.query()
					.where("item_id", item.id)
					.firstOrFail();
				return { item, lot };
			});
		const inkA = await tracked(a, "Ink", "A-1");
		const shaderA = await tracked(a, "Shader", "A-2");
		const inkB = await tracked(b, "Ink", "B-1");
		const snapshot = (target: typeof a) =>
			inTenant(target.tenant, async () => ({
				lots: (
					await InventoryLot.query()
						.where("tenant_id", target.tenant.id)
						.orderBy("id")
				).map((lot) => lot.serialize()),
				items: (
					await InventoryItem.query()
						.where("tenant_id", target.tenant.id)
						.orderBy("id")
				).map((item) => item.serialize()),
				movements: (
					await InventoryMovement.query()
						.where("tenant_id", target.tenant.id)
						.orderBy("id")
				).map((movement) => movement.serialize()),
			}));
		const beforeA = await snapshot(a);
		const beforeB = await snapshot(b);

		// Over HTTP: studio A's owner names B's lot, then another item's lot.
		const use = (lotId: string) =>
			client
				.post(`/t/${a.tenant.slug}/inventory/${inkA.item.id}/movements`)
				.loginAs(a.owner)
				.withCsrfToken()
				.redirects(0)
				.form({ requestId: randomUUID(), kind: "use", quantity: "1", lotId });
		assertValidationError(await use(inkB.lot.id), "lotId");
		assertValidationError(await use(shaderA.lot.id), "lotId");
		(
			await client
				.get(`/t/${a.tenant.slug}/inventory/${inkA.item.id}?lot=${inkB.lot.id}`)
				.loginAs(a.owner)
		).assertStatus(404);
		(
			await client
				.get(
					`/t/${a.tenant.slug}/inventory/${inkA.item.id}?lot=${shaderA.lot.id}`,
				)
				.loginAs(a.owner)
		).assertStatus(404);

		// The service's own filters, from inside A's context with B's ids.
		await inTenant(a.tenant, async () => {
			const {
				choices: lots,
				listed,
				assigned,
			} = await service.lots(b.tenant.id, inkA.item.id);
			assert.lengthOf(lots, 0);
			assert.equal(listed.total, 0);
			assert.equal(assigned, 0);
			await assert.rejects(() => service.restore(b.tenant.id, inkA.item.id));
			assert.lengthOf(await service.exportLots(b.tenant.id), 0);
			await assert.rejects(() =>
				service.findLot(b.tenant.id, inkA.item.id, inkA.lot.id),
			);
			await assert.rejects(() =>
				service.setTracking(b.tenant.id, inkA.item.id, "standard"),
			);
			assert.equal(
				(await service.expiryFlags(b.tenant.id, [inkA.item.id], "2100-01-01"))
					.size,
				0,
			);
		});

		// The database refuses a movement naming another item's lot.
		await inTenant(a.tenant, async () => {
			// In a savepoint of its own, so the refusal leaves the test's
			// transaction usable.
			await assert.rejects(() =>
				withTransaction(() =>
					InventoryMovement.create({
						tenantId: a.tenant.id,
						itemId: inkA.item.id,
						userId: a.owner.id,
						requestId: randomUUID(),
						kind: "use",
						delta: -1000,
						balanceAfter: 4000,
						lotId: shaderA.lot.id,
						lotDelta: -1000,
						lotBalanceAfter: 4000,
					}),
				),
			);
		});

		assert.deepEqual(await snapshot(a), beforeA);
		assert.deepEqual(await snapshot(b), beforeB);
	});

	test("only receipts and assignments name a lot by number; an artist cannot date or re-date a lot", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, artist } = await studio("lots-dates");
		const item = await inTenant(tenant, async () => {
			const ink = await service.create(tenant.id, { name: "Ink", unit: "ml" });
			await service.setTracking(tenant.id, ink.id, "lot");
			await service.record(tenant.id, ink.id, owner.id, {
				requestId: randomUUID(),
				kind: "receive",
				quantity: "5",
				lotNumber: "A1",
			});
			return ink;
		});
		const detail = `/t/${tenant.slug}/inventory/${item.id}`;
		const lotOf = () =>
			inTenant(tenant, () =>
				InventoryLot.query().where("item_id", item.id).firstOrFail(),
			);
		const lot = await lotOf();
		const post = (user: User, body: Record<string, string>) =>
			client
				.post(`${detail}/movements`)
				.loginAs(user)
				.withCsrfToken()
				.redirects(0)
				.form({ requestId: randomUUID(), ...body });
		const expiry = (user: User, body: Record<string, string>) =>
			client
				.put(`${detail}/lot-expiry`)
				.loginAs(user)
				.withCsrfToken()
				.redirects(0)
				.form(body);

		// A use or a count picks a lot by id; a number and a date change nothing.
		for (const [user, kind] of [
			[artist, "use"],
			[owner, "use"],
			[owner, "count"],
		] as const) {
			assertValidationError(
				await post(user, {
					kind,
					quantity: "0.001",
					lotNumber: "a1",
					expiresOn: "2000-01-01",
				}),
				"lotId",
			);
		}
		assert.isNull((await lotOf()).expiresOn);

		// Owners correct a date; artists cannot.
		(
			await expiry(artist, { lotId: lot.id, expiresOn: "2027-03-01" })
		).assertStatus(404);
		(
			await expiry(owner, { lotId: lot.id, expiresOn: "2027-03-01" })
		).assertStatus(302);
		assert.equal((await lotOf()).expiresOn?.toISODate(), "2027-03-01");
		assertValidationError(
			await expiry(owner, { lotId: lot.id, expiresOn: "2027-02-30" }),
			"expiresOn",
		);
		(
			await expiry(owner, { lotId: lot.id, expiresOn: "2028-03-01" })
		).assertStatus(302);
		assert.equal((await lotOf()).expiresOn?.toISODate(), "2028-03-01");
		(await expiry(owner, { lotId: lot.id, expiresOn: "" })).assertStatus(302);
		assert.isNull((await lotOf()).expiresOn);

		// A receipt dates an undated lot; a lot with stock keeps its date, an
		// empty one takes the new delivery's.
		(
			await post(owner, {
				kind: "receive",
				quantity: "1",
				lotNumber: "a1",
				expiresOn: "2027-03-01",
			})
		).assertStatus(302);
		assertValidationError(
			await post(owner, {
				kind: "receive",
				quantity: "1",
				lotNumber: "A1",
				expiresOn: "2028-03-01",
			}),
			"expiresOn",
		);
		(
			await post(owner, { kind: "count", quantity: "0", lotId: lot.id })
		).assertStatus(302);
		(
			await post(owner, {
				kind: "receive",
				quantity: "2",
				lotNumber: "A1",
				expiresOn: "2028-03-01",
			})
		).assertStatus(302);
		const after = await lotOf();
		assert.equal(after.expiresOn?.toISODate(), "2028-03-01");
		assert.equal(after.quantity, 2000);
		await assertReconciles(assert, tenant, item.id, true);
	});

	test("a replayed request records nothing and says so; a reused id with other values is refused", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studio("lots-replay");
		const { tracked, setup } = await inTenant(tenant, async () => {
			const ink = await service.create(tenant.id, { name: "Ink", unit: "ml" });
			await service.setTracking(tenant.id, ink.id, "lot");
			await service.record(tenant.id, ink.id, owner.id, {
				requestId: randomUUID(),
				kind: "receive",
				quantity: "5",
				lotNumber: "R1",
			});
			const gloves = await service.create(tenant.id, {
				name: "Gloves",
				unit: "box",
			});
			await service.record(tenant.id, gloves.id, owner.id, {
				requestId: randomUUID(),
				kind: "receive",
				quantity: "6",
			});
			return { tracked: ink, setup: gloves };
		});
		const lotId = (
			await inTenant(tenant, () =>
				InventoryLot.query().where("item_id", tracked.id).firstOrFail(),
			)
		).id;
		const post = (itemId: string, body: Record<string, string>) =>
			client
				.post(`/t/${tenant.slug}/inventory/${itemId}/movements`)
				.loginAs(owner)
				.withCsrfToken()
				.redirects(0)
				.form(body);
		const movements = (itemId: string) =>
			inTenant(
				tenant,
				async () =>
					(
						await InventoryMovement.query()
							.where("item_id", itemId)
							.count("* as n")
							.pojo<{ n: string }>()
					)[0].n,
			);

		const cases: [string, Record<string, string>][] = [
			[tracked.id, { kind: "count", quantity: "4", lotId }],
			[tracked.id, { kind: "use", quantity: "1", lotId }],
			[setup.id, { kind: "use", quantity: "1" }],
			[setup.id, { kind: "assign", quantity: "2", lotNumber: "G1" }],
		];
		for (const [itemId, body] of cases) {
			const request = { ...body, requestId: randomUUID() };
			const first = await post(itemId, request);
			first.assertFlashMessage("success", "Stock movement recorded.");
			const count = await movements(itemId);
			const replay = await post(itemId, request);
			replay.assertFlashMessage(
				"success",
				"This movement was already recorded. Nothing new was added.",
			);
			assert.equal(await movements(itemId), count, body.kind);
			assertValidationError(
				await post(itemId, { ...request, quantity: "0.5" }),
				"quantity",
			);
		}
		const g1 = (
			await inTenant(tenant, () =>
				InventoryLot.query()
					.where("item_id", setup.id)
					.where("lot_number", "G1")
					.firstOrFail(),
			)
		).id;
		const release = {
			kind: "release",
			quantity: "1",
			lotId: g1,
			requestId: randomUUID(),
		};
		(await post(setup.id, release)).assertStatus(302);
		const count = await movements(setup.id);
		(await post(setup.id, release)).assertFlashMessage(
			"success",
			"This movement was already recorded. Nothing new was added.",
		);
		assert.equal(await movements(setup.id), count);
		await assertReconciles(assert, tenant, tracked.id, true);
		await assertReconciles(assert, tenant, setup.id, false);
	});

	test("quantities: a leading decimal point works, an exponent is refused in words, and lots keep the ceiling", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studio("lots-numbers");
		const item = await inTenant(tenant, async () => {
			const ink = await service.create(tenant.id, { name: "Ink", unit: "ml" });
			await service.setTracking(tenant.id, ink.id, "lot");
			return ink;
		});
		const post = (body: Record<string, string>) =>
			client
				.post(`/t/${tenant.slug}/inventory/${item.id}/movements`)
				.loginAs(owner)
				.withCsrfToken()
				.redirects(0)
				.form({ requestId: randomUUID(), kind: "receive", ...body });
		(await post({ quantity: ".5", lotNumber: "N1" })).assertStatus(302);
		const exponent = await post({ quantity: "1e3", lotNumber: "N1" });
		assertValidationError(exponent, "quantity");
		assert.deepEqual(exponent.flashMessage("inputErrorsBag")?.quantity, [
			"Enter a number with up to 3 decimal places, like 2.5.",
		]);
		(await post({ quantity: "1999999.5", lotNumber: "N1" })).assertStatus(302);
		assertValidationError(
			await post({ quantity: "0.001", lotNumber: "N2" }),
			"quantity",
		);
		const lots = await inTenant(tenant, () =>
			InventoryLot.query().where("item_id", item.id).orderBy("lot_number"),
		);
		assert.deepEqual(
			lots.map((lot) => [lot.lotNumber, lot.quantity]),
			[["N1", 2_000_000_000]],
		);
		await assertReconciles(assert, tenant, item.id, true);
	});

	test("CSV duplicates are found whatever the row order", async ({
		client,
	}) => {
		const { owner, tenant } = await studio("lots-csv-order");
		const upload = (rows: string) =>
			client
				.post(`/t/${tenant.slug}/inventory/import`)
				.loginAs(owner)
				.withCsrfToken()
				.redirects(0)
				.file(
					"csv",
					Buffer.from(
						`name,sku,category,unit,quantity,reorder_threshold\n${rows}`,
					),
					{ filename: "inventory.csv", contentType: "text/csv" },
				);
		for (const rows of [
			"Ink,,,ml,1,\nink,SK1,,ml,1,\n",
			"Ink,SK1,,ml,1,\nink,,,ml,1,\n",
		]) {
			(await upload(rows)).assertFlashMessage(
				"error",
				`An item with this SKU or name already exists: ${rows.startsWith("Ink,,") ? "SK1" : "ink"}.`,
			);
		}
		(await upload("Ink,SK1,,ml,1,\nInk,SK2,,ml,1,\n")).assertFlashMessage(
			"success",
			"Imported 2 inventory items.",
		);
		// Against the catalog as well: a SKU-less "ink" now matches both.
		(await upload("ink,,,ml,1,\n")).assertFlashMessage(
			"error",
			"An item with this SKU or name already exists: ink.",
		);
	});

	test("promoting an artist who holds inventory access makes them an owner", async ({
		client,
		assert,
	}) => {
		const { owner, tenant, artist } = await studio("lots-promote");
		const membership = await inTenant(tenant, () =>
			TenantMembership.query()
				.where("tenant_id", tenant.id)
				.where("user_id", artist.id)
				.firstOrFail(),
		);
		assert.isTrue(membership.inventoryAccess);
		(
			await client
				.put(`/t/${tenant.slug}/settings/members/${membership.id}/role`)
				.loginAs(owner)
				.withCsrfToken()
				.redirects(0)
				.form({ role: "owner" })
		).assertStatus(302);
		const promoted = await inTenant(tenant, () =>
			TenantMembership.findOrFail(membership.id),
		);
		assert.equal(promoted.role, "owner");
		assert.isFalse(promoted.inventoryAccess);
		const page = await client
			.get(`/t/${tenant.slug}/inventory`)
			.loginAs(artist)
			.withInertia();
		assert.isTrue(page.inertiaProps.canManage);
	});
});
