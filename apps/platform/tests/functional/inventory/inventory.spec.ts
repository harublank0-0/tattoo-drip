import { randomUUID } from "node:crypto";
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import User from "#models/user";
import InventoryService from "#modules/inventory/services/inventory_service";
import TenantMembership from "#modules/tenancy/models/tenant_membership";
import TenancyService from "#modules/tenancy/services/tenancy_service";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";
import { assertValidationError } from "#tests/helpers/validation";

const service = new InventoryService();

test.group("Studio OS inventory", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an independent artist can add, receive, use, recount and archive an item with history", async ({
		client,
		assert,
	}) => {
		const owner = await User.create({
			email: "artist@inventory.example",
			password: "secret-password",
		});
		const tenant = await new TenancyService().createTenant(owner, {
			type: "independent",
			name: "Inventory Artist",
			slug: "inventory-artist",
			timezone: "Asia/Kathmandu",
		});
		const base = `/t/${tenant.slug}/inventory`;
		const created = await client
			.post(base)
			.loginAs(owner)
			.withCsrfToken()
			.redirects(0)
			.form({
				name: "Black ink",
				unit: "ml",
				category: "Ink",
				sku: "",
				reorderThreshold: "2.5",
			});
		created.assertStatus(302);
		const catalog = await client.get(base).loginAs(owner).withInertia();
		catalog.assertStatus(200);
		catalog.assertInertiaComponent("inventory/index");
		assert.lengthOf(catalog.inertiaProps.items, 1);
		const itemId = catalog.inertiaProps.items[0].id;
		const detail = `${base}/${itemId}`;
		const movement = (body: Record<string, string>) =>
			client
				.post(`${detail}/movements`)
				.loginAs(owner)
				.withCsrfToken()
				.redirects(0)
				.form(body);
		const receipt = {
			kind: "receive",
			quantity: "5.125",
			requestId: randomUUID(),
			note: "",
		};
		(await movement(receipt)).assertStatus(302);
		(await movement(receipt)).assertStatus(302);
		(
			await movement({ kind: "use", quantity: "3", requestId: randomUUID() })
		).assertStatus(302);
		const refusal = await movement({
			kind: "use",
			quantity: "3",
			requestId: randomUUID(),
		});
		assertValidationError(refusal, "quantity");

		const low = await client
			.get(`${base}?status=low&q=Ink`)
			.loginAs(owner)
			.withInertia();
		assert.lengthOf(low.inertiaProps.items, 1);
		assert.equal(low.inertiaProps.items[0].quantity, 2125);
		const show = await client.get(detail).loginAs(owner).withInertia();
		show.assertStatus(200);
		show.assertInertiaComponent("inventory/show");
		assert.deepEqual(
			show.inertiaProps.history.map((row: { delta: number }) => row.delta),
			[-3000, 5125],
		);

		const blocked = await client
			.delete(detail)
			.loginAs(owner)
			.withCsrfToken()
			.redirects(0);
		blocked.assertFlashMessage(
			"error",
			"Record or correct the remaining stock before archiving this item.",
		);
		(
			await movement({ kind: "count", quantity: "0", requestId: randomUUID() })
		).assertStatus(302);
		(
			await client.delete(detail).loginAs(owner).withCsrfToken().redirects(0)
		).assertStatus(302);
		const archived = await client
			.get(`${base}?status=archived`)
			.loginAs(owner)
			.withInertia();
		assert.lengthOf(archived.inertiaProps.items, 1);
		assert.isTrue(archived.inertiaProps.items[0].archived);
		const archiveDetail = await client.get(detail).loginAs(owner).withInertia();
		assert.lengthOf(archiveDetail.inertiaProps.history, 3);
	});

	test("service filters still hold inside the other studio's database context", async ({
		assert,
	}) => {
		const { tenant: a, owner } = await studioWithOwner("inventory-a");
		const { tenant: b } = await studioWithOwner("inventory-b");
		await inTenant(a, async () => {
			const item = await service.create(a.id, { name: "Needles", unit: "box" });
			await service.record(a.id, item.id, owner.id, {
				requestId: randomUUID(),
				kind: "receive",
				quantity: "2",
			});

			assert.lengthOf(
				(await service.list(b.id, "active", "Needles", 1, "2026-11-12")).all(),
				0,
			);
			assert.lengthOf(
				(await service.history(b.id, item.id, 1)).movements.all(),
				0,
			);
			await assert.rejects(() => service.find(b.id, item.id));
			await assert.rejects(() =>
				service.update(b.id, item.id, { name: "Other" }),
			);
			await assert.rejects(() =>
				service.record(b.id, item.id, owner.id, {
					requestId: randomUUID(),
					kind: "use",
					quantity: "2",
				}),
			);
			await assert.rejects(() => service.archive(b.id, item.id));
			assert.equal((await service.find(a.id, item.id)).quantity, 2000);
		});
	});
	test("owners can grant and revoke usage without granting other inventory writes", async ({
		client,
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner("inventory-staff");
		const artist = await artistIn(tenant, "ink@inventory-staff.example");
		await artist.merge({ fullName: "Sita Rai" }).save();
		const membership = await inTenant(tenant, () =>
			TenantMembership.query()
				.where("tenant_id", tenant.id)
				.where("user_id", artist.id)
				.firstOrFail(),
		);
		const item = await inTenant(tenant, async () => {
			const stock = await service.create(tenant.id, {
				name: "Ink",
				unit: "ml",
			});
			await service.record(tenant.id, stock.id, owner.id, {
				requestId: randomUUID(),
				kind: "receive",
				quantity: "5",
			});
			return stock;
		});
		const base = `/t/${tenant.slug}/inventory`;
		const detail = `${base}/${item.id}`;
		const grant = `/t/${tenant.slug}/settings/members/${membership.id}/inventory`;
		const change = (enabled: boolean, user = owner) =>
			client
				.put(grant)
				.loginAs(user)
				.withCsrfToken()
				.redirects(0)
				.json({ enabled });
		const movement = (kind: string) =>
			client
				.post(`${detail}/movements`)
				.loginAs(artist)
				.withCsrfToken()
				.redirects(0)
				.form({ kind, quantity: "2", requestId: randomUUID() });
		(await client.get(base).loginAs(artist)).assertStatus(404);
		(await change(true, artist)).assertStatus(404);
		(await movement("use")).assertStatus(404);
		(await change(true)).assertStatus(302);

		const catalog = await client.get(base).loginAs(artist).withInertia();
		catalog.assertStatus(200);
		assert.isFalse(catalog.inertiaProps.canManage);
		assert.isTrue(catalog.inertiaProps.tenant.inventoryAccess);
		(await movement("receive")).assertStatus(404);
		(await movement("count")).assertStatus(404);
		(await client.get(`${base}/export.csv`).loginAs(artist)).assertStatus(404);
		(await movement("use")).assertStatus(302);
		const history = await client.get(detail).loginAs(owner).withInertia();
		assert.equal(history.inertiaProps.item.quantity, 3000);
		assert.equal(history.inertiaProps.history[0].actor, "Sita Rai");

		(await change(false)).assertStatus(302);
		(await client.get(detail).loginAs(artist)).assertStatus(404);
		(await movement("use")).assertStatus(404);
	});

	test("CSV import records opening stock, rejects duplicate batches atomically, and exports safe cells", async ({
		client,
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner("inventory-csv");
		const base = `/t/${tenant.slug}/inventory`;
		const header = "name,sku,category,unit,quantity,reorder_threshold\n";
		const upload = (content: string) =>
			client
				.post(`${base}/import`)
				.loginAs(owner)
				.withCsrfToken()
				.redirects(0)
				.file("csv", Buffer.from(content), {
					filename: "inventory.csv",
					contentType: "text/csv",
				});
		const rows = '"Liner, black",INK-1,=1+1,ml,12.5,2.25\n';
		const added = await upload(header + rows);
		added.assertStatus(302);
		added.assertFlashMessage("success", "Imported 1 inventory item.");
		const duplicate = await upload(
			`${header}Should roll back,NEW,,piece,2,\n${rows}`,
		);
		duplicate.assertStatus(302);
		duplicate.assertFlashMessage(
			"error",
			"An item with this SKU or name already exists: INK-1.",
		);
		const catalog = await client.get(base).loginAs(owner).withInertia();
		assert.lengthOf(catalog.inertiaProps.items, 1);
		const item = catalog.inertiaProps.items[0];
		assert.equal(item.quantity, 12500);
		assert.equal(item.reorderThreshold, 2250);
		const detail = await client
			.get(`${base}/${item.id}`)
			.loginAs(owner)
			.withInertia();
		assert.lengthOf(detail.inertiaProps.history, 1);
		assert.equal(
			detail.inertiaProps.history[0].note,
			"Opening stock from CSV import",
		);
		const exported = await client.get(`${base}/export.csv`).loginAs(owner);
		exported.assertStatus(200);
		assert.match(exported.header("content-type") ?? "", /^text\/csv/);
		exported.assertHeader(
			"content-disposition",
			'attachment; filename="inventory.csv"',
		);
		assert.include(
			exported.text(),
			`"Liner, black","INK-1","'=1+1",ml,12.5,2.25`,
		);
	});
});
