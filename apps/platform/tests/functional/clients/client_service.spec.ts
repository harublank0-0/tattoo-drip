import { randomUUID } from "node:crypto";
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import { ClientRuleError } from "#modules/clients/errors";
import Client from "#modules/clients/models/client";
import ClientService, {
	CLIENTS_PER_PAGE,
} from "#modules/clients/services/client_service";
import { makeClient } from "#tests/helpers/pipeline";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

const clients = new ClientService();

const namesOf = (list: { name: string }[]) => list.map(({ name }) => name);

/** The ClientRuleError reason `work` throws, or null if it succeeds. */
async function reasonOf(work: () => Promise<unknown>) {
	try {
		await work();
		return null;
	} catch (error) {
		if (error instanceof ClientRuleError) return error.reason;
		throw error;
	}
}

test.group("ClientService.list", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("lists live clients, newest first, 25 per page", async ({ assert }) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			for (let i = 0; i < CLIENTS_PER_PAGE; i++) {
				await makeClient(tenant, { name: `Old ${i}` });
			}
			await makeClient(tenant, { name: "Newest" });
			const gone = await makeClient(tenant, { name: "Deleted" });
			await gone.softDelete();

			const first = await clients.list(tenant, { search: "", page: 1 });
			assert.equal(first.clients[0].name, "Newest");
			assert.lengthOf(first.clients, CLIENTS_PER_PAGE);
			assert.equal(first.total, CLIENTS_PER_PAGE + 1);
			assert.equal(first.lastPage, 2);
			assert.notInclude(namesOf(first.clients), "Deleted");
			assert.lengthOf(
				(await clients.list(tenant, { search: "", page: 2 })).clients,
				1,
			);
		});
	});

	test("a page past the end gives the last page; an absurd page number still works", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			for (let i = 0; i < CLIENTS_PER_PAGE + 1; i++) {
				await makeClient(tenant, { name: `Client ${i}` });
			}

			const first = await clients.list(tenant, { search: "", page: 1 });
			assert.equal(first.page, 1);

			const past = await clients.list(tenant, { search: "", page: 9 });
			assert.equal(past.page, 2);
			assert.lengthOf(past.clients, 1);

			const absurd = await clients.list(tenant, { search: "", page: 1e20 });
			assert.equal(absurd.page, 2);
			assert.lengthOf(absurd.clients, 1);

			const none = await clients.list(tenant, {
				search: "nobody-at-all",
				page: 4,
			});
			assert.deepEqual([none.clients.length, none.total, none.page], [0, 0, 1]);
		});
	});

	test("searches part of a name in any case, literally", async ({ assert }) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			await makeClient(tenant, { name: "Sita Rai" });
			await makeClient(tenant, { name: "Ram Thapa" });
			await makeClient(tenant, { name: "100% Ink" });
			await makeClient(tenant, { name: "a_b" });
			await makeClient(tenant, { name: "axb" });

			const search = async (term: string) =>
				namesOf(
					(await clients.list(tenant, { search: term, page: 1 })).clients,
				);

			assert.deepEqual(await search("sItA"), ["Sita Rai"]);
			assert.deepEqual(await search("  rai "), ["Sita Rai"]);
			assert.deepEqual(await search("%"), ["100% Ink"]);
			assert.deepEqual(await search("a_b"), ["a_b"]);
			assert.deepEqual(await search("\\"), []);
			assert.lengthOf(await search("   "), 5);
		});
	});

	test("searches phone digits from 3 digits, however they are typed", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			await makeClient(tenant, { name: "Sita", phone: "+9779812345678" });
			await makeClient(tenant, { name: "Ram", phone: "+9779801112223" });

			const search = async (term: string) =>
				namesOf(
					(await clients.list(tenant, { search: term, page: 1 })).clients,
				);

			assert.deepEqual(await search("98123"), ["Sita"]);
			assert.deepEqual(await search("981-234 5678"), ["Sita"]);
			assert.deepEqual(await search("+977 9812345678"), ["Sita"]);
			assert.deepEqual(await search("98"), []);
		});
	});

	test("another tenant's clients never show", async ({ assert }) => {
		const { tenant: a } = await studioWithOwner("studio-a", "Studio A");
		const { tenant: b } = await studioWithOwner("studio-b", "Studio B");
		await inTenant(a, () => makeClient(a, { name: "Theirs" }));

		await inTenant(b, async () => {
			assert.lengthOf(
				(await clients.list(b, { search: "", page: 1 })).clients,
				0,
			);
		});
	});
});

test.group("ClientService finds and updates", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("findFor finds the live client; deleted and foreign ones are 404s", async ({
		assert,
	}) => {
		const { tenant: a } = await studioWithOwner("studio-a", "Studio A");
		const { tenant: b } = await studioWithOwner("studio-b", "Studio B");
		const theirs = await inTenant(b, () => makeClient(b));

		await inTenant(a, async () => {
			const mine = await makeClient(a);
			const gone = await makeClient(a);
			await gone.softDelete();

			assert.equal((await clients.findFor(a, mine.id)).id, mine.id);
			for (const id of [gone.id, theirs.id, randomUUID()]) {
				await assert.rejects(() => clients.findFor(a, id), /Row not found/);
			}
		});
	});

	test("findByPhone finds the live client with that number", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const sita = await makeClient(tenant, { phone: "+9779812345678" });
			assert.equal(
				(await clients.findByPhone(tenant, "+9779812345678"))?.id,
				sita.id,
			);
			assert.isNull(await clients.findByPhone(tenant, "+9779800000000"));
		});
	});

	test("update saves the details; empty email and notes become null", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const client = await makeClient(tenant, {
				email: "old@example.com",
				notes: "Old note",
			});

			await clients.update(tenant, client, {
				name: "Sita Rai",
				phone: "+9779812345678",
				email: "",
				notes: "",
			});

			const saved = await Client.findOrFail(client.id);
			assert.deepEqual(
				[saved.name, saved.phone, saved.email, saved.notes],
				["Sita Rai", "+9779812345678", null, null],
			);
		});
	});

	test("a number another live client has is refused; a deleted client's number is free", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			await makeClient(tenant, { name: "Ram", phone: "+9779801112223" });
			const gone = await makeClient(tenant, { phone: "+9779805556667" });
			await gone.softDelete();
			const sita = await makeClient(tenant, { name: "Sita" });
			const before = sita.phone;

			assert.equal(
				await reasonOf(() =>
					clients.update(tenant, sita, {
						name: "Sita",
						phone: "+9779801112223",
						email: null,
						notes: null,
					}),
				),
				"phone_taken",
			);
			assert.equal((await Client.findOrFail(sita.id)).phone, before);

			await clients.update(tenant, sita, {
				name: "Sita",
				phone: "+9779805556667",
				email: null,
				notes: null,
			});
			assert.equal((await Client.findOrFail(sita.id)).phone, "+9779805556667");
		});
	});

	test("an anonymized client is never edited", async ({ assert }) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const client = await makeClient(tenant, {
				phone: null,
				anonymizedAt: DateTime.utc(),
			});

			assert.equal(
				await reasonOf(() =>
					clients.update(tenant, client, {
						name: "Back",
						phone: "+9779812345678",
						email: null,
						notes: null,
					}),
				),
				"anonymized",
			);
			assert.isNull((await Client.findOrFail(client.id)).phone);
		});
	});
});
