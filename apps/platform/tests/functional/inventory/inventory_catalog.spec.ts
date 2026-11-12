import { randomUUID } from "node:crypto";
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import type User from "#models/user";
import InventoryItem from "#modules/inventory/models/inventory_item";
import InventoryLot from "#modules/inventory/models/inventory_lot";
import InventoryService from "#modules/inventory/services/inventory_service";
import TenantMembership from "#modules/tenancy/models/tenant_membership";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";
import { assertValidationError } from "#tests/helpers/validation";

const service = new InventoryService();

test.group("Studio OS inventory catalog", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("the item forms refuse another item's SKU, or its name where either has no SKU", async ({
		client,
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner("inventory-dupes");
		const base = `/t/${tenant.slug}/inventory`;
		const add = (body: Record<string, string>) =>
			client
				.post(base)
				.loginAs(owner)
				.withCsrfToken()
				.redirects(0)
				.form({ unit: "ml", ...body });
		const edit = (id: string, body: Record<string, string>) =>
			client
				.put(`${base}/${id}`)
				.loginAs(owner)
				.withCsrfToken()
				.redirects(0)
				.form(body);
		const messageOf = (
			response: Awaited<ReturnType<typeof add>>,
			field: string,
		) =>
			(
				response.flashMessage("inputErrorsBag") as
					| Record<string, string[]>
					| undefined
			)?.[field]?.[0];

		(await add({ name: "Black ink" })).assertStatus(302);
		(await add({ name: "Lining ink", sku: "INK-1" })).assertStatus(302);

		const sameName = await add({ name: "black INK" });
		assertValidationError(sameName, "name");
		assert.equal(
			messageOf(sameName, "name"),
			"Another item already uses this name: Black ink.",
		);
		// A SKU'd item still clashes with a SKU-less one of the same name.
		assertValidationError(await add({ name: "Black ink", sku: "B-2" }), "name");
		const sameSku = await add({ name: "Other", sku: "ink-1" });
		assertValidationError(sameSku, "sku");
		assert.equal(
			messageOf(sameSku, "sku"),
			"Another item already uses this SKU: Lining ink.",
		);
		// Two SKUs tell items of one name apart.
		(await add({ name: "Lining ink", sku: "INK-2" })).assertStatus(302);

		const items = await inTenant(tenant, () =>
			InventoryItem.query().where("tenant_id", tenant.id).orderBy("sku"),
		);
		assert.lengthOf(items, 3);
		const [ink1, ink2] = items;
		// Editing: keeping its own name and SKU is fine; another's SKU is not.
		(
			await edit(ink1.id, { name: "Lining ink", sku: "INK-1", category: "Ink" })
		).assertStatus(302);
		assertValidationError(
			await edit(ink2.id, { name: "Lining ink", sku: "INK-1" }),
			"sku",
		);

		// An archived item keeps its identity; the message says to restore it.
		await inTenant(tenant, () => service.archive(tenant.id, ink2.id));
		const archived = await add({ name: "Anything", sku: "INK-2" });
		assertValidationError(archived, "sku");
		assert.equal(
			messageOf(archived, "sku"),
			"An archived item already uses this SKU: Lining ink. Restore it from the archived list instead.",
		);
	});

	test("owners restore an archived item with its history; artists cannot", async ({
		client,
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner("inventory-restore");
		const artist = await artistIn(tenant, "ink@inventory-restore.example");
		await inTenant(tenant, async () => {
			const membership = await TenantMembership.query()
				.where("tenant_id", tenant.id)
				.where("user_id", artist.id)
				.firstOrFail();
			await membership.merge({ inventoryAccess: true }).save();
		});
		const item = await inTenant(tenant, async () => {
			const gloves = await service.create(tenant.id, {
				name: "Gloves",
				unit: "box",
			});
			await service.record(tenant.id, gloves.id, owner.id, {
				requestId: randomUUID(),
				kind: "receive",
				quantity: "2",
			});
			await service.record(tenant.id, gloves.id, owner.id, {
				requestId: randomUUID(),
				kind: "count",
				quantity: "0",
			});
			await service.archive(tenant.id, gloves.id);
			return gloves;
		});
		const detail = `/t/${tenant.slug}/inventory/${item.id}`;
		const restore = (user: User) =>
			client
				.post(`${detail}/restore`)
				.loginAs(user)
				.withCsrfToken()
				.redirects(0);

		(await restore(artist)).assertStatus(404);
		const restored = await restore(owner);
		restored.assertStatus(302);
		restored.assertFlashMessage("success", "Inventory item restored.");
		const page = await client.get(detail).loginAs(owner).withInertia();
		assert.isFalse(page.inertiaProps.item.archived);
		assert.lengthOf(page.inertiaProps.history, 2);
		// An active item: nothing to restore.
		(await restore(owner)).assertStatus(404);

		// Refused when an active item took its identity meanwhile (data from
		// before the forms checked it).
		await inTenant(tenant, async () => {
			await service.archive(tenant.id, item.id);
			await InventoryItem.create({
				tenantId: tenant.id,
				name: "gloves",
				unit: "box",
				quantity: 0,
			});
		});
		const refused = await restore(owner);
		refused.assertFlashMessage(
			"error",
			"Another item already uses this name: gloves.",
		);
		const still = await inTenant(tenant, () =>
			InventoryItem.withTrashed().where("id", item.id).firstOrFail(),
		);
		assert.isNotNull(still.deletedAt);
	});

	test("the Lots list pages through every lot; a lot's history makes it selectable beyond the first 100", async ({
		client,
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner("inventory-many-lots");
		const item = await inTenant(tenant, async () => {
			const ink = await service.create(tenant.id, { name: "Ink", unit: "ml" });
			await service.setTracking(tenant.id, ink.id, "lot");
			for (let n = 1; n <= 101; n++) {
				await service.record(tenant.id, ink.id, owner.id, {
					requestId: randomUUID(),
					kind: "receive",
					quantity: "1",
					lotNumber: `L${n}`,
					// Later lots expire later, so L101 is the last to use.
					expiresOn: DateTime.fromISO("2030-01-01")
						.plus({ days: n })
						.toISODate() as string,
				});
			}
			return ink;
		});
		const detail = `/t/${tenant.slug}/inventory/${item.id}`;
		const view = async (query = "") =>
			(await client.get(`${detail}${query}`).loginAs(owner).withInertia())
				.inertiaProps;

		const first = await view();
		assert.equal(first.lotList.total, 101);
		assert.equal(first.lotList.lastPage, 5);
		assert.lengthOf(first.lotList.rows, 25);
		assert.equal(first.lotList.rows[0].number, "L1");
		assert.lengthOf(first.lots, 100);
		const last = await view("?lots=5");
		assert.deepEqual(
			last.lotList.rows.map((lot: { number: string }) => lot.number),
			["L101"],
		);
		const l101 = last.lotList.rows[0].id;
		assert.notInclude(
			first.lots.map((lot: { id: string }) => lot.id),
			l101,
		);
		// Past the end: the last page, not an empty list.
		const beyond = await view("?lots=9");
		assert.equal(beyond.lotList.page, 5);
		assert.lengthOf(beyond.lotList.rows, 1);
		// Saving an expiry from Lots page 5 comes back to page 5.
		const saved = await client
			.put(`${detail}/lot-expiry`)
			.loginAs(owner)
			.withCsrfToken()
			.header("referer", `http://localhost${detail}?lots=5&evil=x`)
			.redirects(0)
			.form({ lotId: l101, expiresOn: "2031-01-01" });
		saved.assertStatus(302);
		assert.equal(saved.header("location"), `${detail}?lots=5`);
		const focused = await view(`?lot=${l101}`);
		assert.lengthOf(focused.lots, 101);
		assert.equal(focused.lots[100].id, l101);
		assert.equal(focused.suggestedLotId, first.lots[0].id);
	});

	test("the lots CSV lists every lot with stock of an active item, safe for spreadsheets", async ({
		client,
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner("inventory-lots-csv");
		await inTenant(tenant, async () => {
			const receive = async (
				itemId: string,
				lotNumber: string,
				quantity: string,
				expiresOn?: string,
			) =>
				service.record(tenant.id, itemId, owner.id, {
					requestId: randomUUID(),
					kind: "receive",
					quantity,
					lotNumber,
					expiresOn,
				});
			const ink = await service.create(tenant.id, {
				name: "Ink, black",
				unit: "ml",
				sku: "INK-1",
			});
			await service.setTracking(tenant.id, ink.id, "lot");
			await receive(ink.id, "B2", "2.5", "2027-06-30");
			await receive(ink.id, "=A1", "1");
			await receive(ink.id, "A1", "4", "2027-01-31");
			const empty = await InventoryLot.query()
				.where("item_id", ink.id)
				.where("lot_number", "B2")
				.firstOrFail();
			await service.record(tenant.id, ink.id, owner.id, {
				requestId: randomUUID(),
				kind: "use",
				quantity: "2.5",
				lotId: empty.id,
			});
			const old = await service.create(tenant.id, {
				name: "Old shader",
				unit: "ml",
			});
			await service.setTracking(tenant.id, old.id, "lot");
			await receive(old.id, "Z9", "1");
			const z9 = await InventoryLot.query()
				.where("item_id", old.id)
				.firstOrFail();
			await service.record(tenant.id, old.id, owner.id, {
				requestId: randomUUID(),
				kind: "count",
				quantity: "0",
				lotId: z9.id,
			});
			await service.archive(tenant.id, old.id);
		});
		const exported = await client
			.get(`/t/${tenant.slug}/inventory/lots.csv`)
			.loginAs(owner);
		exported.assertStatus(200);
		exported.assertHeader("cache-control", "private, no-store");
		exported.assertHeader(
			"content-disposition",
			'attachment; filename="inventory-lots.csv"',
		);
		assert.equal(
			exported.text(),
			[
				"item_name,sku,unit,lot_number,expires_on,quantity",
				`"Ink, black","INK-1",ml,"A1",2027-01-31,4`,
				`"Ink, black","INK-1",ml,"'=A1",,1`,
				"",
			].join("\r\n"),
		);
	});
});
