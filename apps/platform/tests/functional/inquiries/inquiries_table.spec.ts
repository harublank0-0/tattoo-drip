import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import Inquiry, {
	INQUIRY_STATUSES,
	SOURCE_CHANNELS,
} from "#modules/inquiries/models/inquiry";
import { withDbContext, withTransaction } from "#services/db_context";
import { addFlashDesign } from "#tests/helpers/artists";
import { makeArtist, makeClient, makeInquiry } from "#tests/helpers/pipeline";
import { assertRowLevelSecurity } from "#tests/helpers/rls";
import { idOf, insertRow, updateRow } from "#tests/helpers/sql";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

const PHONE = "+9779812345678";

const newInquiry = (
	tenantId: string,
	clientId: string,
	over: Record<string, unknown> = {},
) => ({
	tenant_id: tenantId,
	client_id: clientId,
	idea: "A small moth",
	placement: "Forearm",
	approximate_size: "8 cm",
	preferred_dates: "November",
	source_channel: "instagram",
	contact_name: "Sita",
	contact_phone: PHONE,
	...over,
});

/** One studio with a client, and a second studio's client and artist to link to. */
async function twoTenants() {
	const { tenant: a } = await studioWithOwner("studio-a", "Studio A");
	const { tenant: b } = await studioWithOwner("studio-b", "Studio B");
	const clientA = await inTenant(a, () => makeClient(a));
	const clientB = await inTenant(b, () => makeClient(b));
	const artistB = await inTenant(b, () => makeArtist(b));
	return { a, b, clientA, clientB, artistB };
}

test.group("inquiries table", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an inquiry links only to its own tenant's client and artist; a null artist is not checked", async ({
		assert,
	}) => {
		const { a, clientA, clientB, artistB } = await twoTenants();

		await withDbContext({ tenantId: a.id }, async (trx) => {
			await assert.rejects(
				() =>
					withTransaction((inner) =>
						insertRow(inner, "inquiries", newInquiry(a.id, clientB.id)),
					),
				/inquiries_tenant_id_client_id_foreign/,
			);
			await assert.rejects(
				() =>
					withTransaction((inner) =>
						insertRow(
							inner,
							"inquiries",
							newInquiry(a.id, clientA.id, { preferred_artist_id: artistB.id }),
						),
					),
				/inquiries_tenant_id_preferred_artist_id_foreign/,
			);
			await insertRow(trx, "inquiries", newInquiry(a.id, clientA.id));
		});
	});

	test("a client or artist with an inquiry cannot be hard-deleted", async ({
		assert,
	}) => {
		const { a } = await twoTenants();
		const { client, artist } = await inTenant(a, async () => ({
			client: await makeClient(a),
			artist: await makeArtist(a, "mine"),
		}));

		await withDbContext({ tenantId: a.id }, async (trx) => {
			await insertRow(
				trx,
				"inquiries",
				newInquiry(a.id, client.id, { preferred_artist_id: artist.id }),
			);
			await assert.rejects(
				() =>
					withTransaction((inner) =>
						inner.rawQuery("delete from clients where id = ?", [client.id]),
					),
				/inquiries_tenant_id_client_id_foreign/,
			);
			await assert.rejects(
				() =>
					withTransaction((inner) =>
						inner.rawQuery("delete from artists where id = ?", [artist.id]),
					),
				/inquiries_tenant_id_preferred_artist_id_foreign/,
			);
		});
	});

	test("status and source channel only take their listed values, and a decision matches the status", async ({
		assert,
	}) => {
		const { a, clientA } = await twoTenants();
		const rejects = (over: Record<string, unknown>, message: RegExp) =>
			assert.rejects(
				() =>
					withTransaction((inner) =>
						insertRow(inner, "inquiries", newInquiry(a.id, clientA.id, over)),
					),
				message,
			);

		await withDbContext({ tenantId: a.id }, async () => {
			// Postgres reports the first failing check by name, so give the unknown
			// status a decision time that satisfies inquiries_decided_matches_status.
			await rejects(
				{ status: "maybe", decided_at: new Date() },
				/inquiries_status_check/,
			);
			await rejects(
				{ source_channel: "smoke" },
				/inquiries_source_channel_check/,
			);
			await rejects({ status: "accepted" }, /inquiries_decided_matches_status/);
			await rejects(
				{ status: "new", decided_at: new Date() },
				/inquiries_decided_matches_status/,
			);
		});
	});

	test("the contact phone is E.164, and missing only once the inquiry is anonymized", async ({
		assert,
	}) => {
		const { a, clientA } = await twoTenants();

		await withDbContext({ tenantId: a.id }, async (trx) => {
			await assert.rejects(
				() =>
					withTransaction((inner) =>
						insertRow(
							inner,
							"inquiries",
							newInquiry(a.id, clientA.id, { contact_phone: "9812345678" }),
						),
					),
				/inquiries_contact_phone_e164/,
			);
			await assert.rejects(
				() =>
					withTransaction((inner) =>
						insertRow(
							inner,
							"inquiries",
							newInquiry(a.id, clientA.id, { contact_phone: null }),
						),
					),
				/inquiries_contact_phone_unless_anonymized/,
			);
			await insertRow(
				trx,
				"inquiries",
				newInquiry(a.id, clientA.id, {
					contact_phone: null,
					anonymized_at: new Date(),
				}),
			);
		});
	});

	test("the guard trigger freezes every submitted column", async ({
		assert,
	}) => {
		const { a, b, clientA } = await twoTenants();
		const otherClient = await inTenant(a, () => makeClient(a));
		const artist = await inTenant(a, () => makeArtist(a));
		const design = await inTenant(a, () => addFlashDesign(a, artist));
		const frozen: [string, unknown][] = [
			["tenant_id", b.id],
			["client_id", otherClient.id],
			["idea", "Another idea"],
			["placement", "Ribs"],
			["approximate_size", "20 cm"],
			["preferred_dates", "December"],
			["preferred_artist_id", artist.id],
			// A flash design asked for (TAT-129) is as frozen as the rest.
			["flash_design_id", design.id],
			["budget", "10k"],
			["source_channel", "google"],
			["contact_name", "Someone else"],
			["contact_phone", "+9779800000000"],
			["contact_email", "x@example.com"],
			["created_at", new Date("2020-01-01")],
		];

		await withDbContext({ tenantId: a.id }, async (trx) => {
			const id = idOf(
				await insertRow(trx, "inquiries", newInquiry(a.id, clientA.id)),
			);
			for (const [column, value] of frozen) {
				await assert.rejects(
					() =>
						withTransaction((inner) =>
							updateRow(inner, "inquiries", id, { [column]: value }),
						),
					new RegExp(`inquiries_guard_update: ${column} cannot change`),
				);
			}
		});
	});

	test("the decision, deletion and updated_at are free to change", async ({
		assert,
	}) => {
		const { a, clientA } = await twoTenants();

		await withDbContext({ tenantId: a.id }, async (trx) => {
			const id = idOf(
				await insertRow(trx, "inquiries", newInquiry(a.id, clientA.id)),
			);

			await updateRow(trx, "inquiries", id, {
				status: "accepted",
				decided_at: new Date(),
			});
			await updateRow(trx, "inquiries", id, { updated_at: new Date() });
			await updateRow(trx, "inquiries", id, { deleted_at: new Date() });
			const { rows } = await trx.rawQuery(
				"select status, deleted_at from inquiries where id = ?",
				[id],
			);
			assert.equal(rows[0].status, "accepted");
			assert.isNotNull(rows[0].deleted_at);
		});
	});

	test("the last contact is free to change; everything submitted stays frozen", async ({
		assert,
	}) => {
		const { a, clientA } = await twoTenants();

		await withDbContext({ tenantId: a.id }, async (trx) => {
			const id = idOf(
				await insertRow(trx, "inquiries", newInquiry(a.id, clientA.id)),
			);

			await updateRow(trx, "inquiries", id, {
				last_contacted_at: new Date(),
				last_contact_channel: "whatsapp",
				last_contact_kind: "inquiry_received",
			});
			await updateRow(trx, "inquiries", id, {
				last_contacted_at: new Date(),
				last_contact_channel: null,
				last_contact_kind: null,
			});
			const { rows } = await trx.rawQuery(
				"select last_contacted_at, last_contact_channel from inquiries where id = ?",
				[id],
			);
			assert.isNotNull(rows[0].last_contacted_at);
			assert.isNull(rows[0].last_contact_channel);
			await assert.rejects(
				() =>
					withTransaction((inner) =>
						updateRow(inner, "inquiries", id, {
							last_contacted_at: new Date(),
							idea: "Another idea",
						}),
					),
				/inquiries_guard_update: idea cannot change/,
			);
		});
	});

	test("a last contact's channel and message take listed values and need its time", async ({
		assert,
	}) => {
		const { a, clientA } = await twoTenants();
		const rejects = (over: Record<string, unknown>, message: RegExp) =>
			assert.rejects(
				() =>
					withTransaction((inner) =>
						insertRow(inner, "inquiries", newInquiry(a.id, clientA.id, over)),
					),
				message,
			);

		await withDbContext({ tenantId: a.id }, async () => {
			await rejects(
				{ last_contacted_at: new Date(), last_contact_channel: "sms" },
				/inquiries_last_contact_channel_check/,
			);
			await rejects(
				{ last_contacted_at: new Date(), last_contact_kind: "hello" },
				/inquiries_last_contact_kind_check/,
			);
			await rejects(
				{ last_contact_channel: "viber" },
				/inquiries_last_contact_needs_time/,
			);
		});
	});

	test("the contact snapshot and free text can be scrubbed only in the update that first sets anonymized_at, which then never changes, and they are frozen afterwards", async ({
		assert,
	}) => {
		const { a, clientA } = await twoTenants();

		await withDbContext({ tenantId: a.id }, async (trx) => {
			const id = idOf(
				await insertRow(
					trx,
					"inquiries",
					newInquiry(a.id, clientA.id, {
						budget: "5k",
						contact_email: "s@x.com",
					}),
				),
			);

			await updateRow(trx, "inquiries", id, {
				contact_name: "Deleted client",
				contact_phone: null,
				contact_email: null,
				idea: "[removed]",
				placement: "[removed]",
				approximate_size: "[removed]",
				preferred_dates: "[removed]",
				budget: null,
				anonymized_at: new Date(),
			});

			await assert.rejects(
				() =>
					withTransaction((inner) =>
						updateRow(inner, "inquiries", id, {
							anonymized_at: new Date("2020-01-01"),
						}),
					),
				/inquiries_guard_update: anonymized_at cannot change/,
			);
			await assert.rejects(
				() =>
					withTransaction((inner) =>
						updateRow(inner, "inquiries", id, { source_channel: "google" }),
					),
				/inquiries_guard_update: source_channel cannot change/,
			);

			// The scrub was a one-shot: personal data cannot be written back.
			const restored: [string, unknown][] = [
				["contact_name", "Sita"],
				["contact_phone", PHONE],
				["contact_email", "s@x.com"],
				["idea", "A small moth"],
				["placement", "Forearm"],
				["approximate_size", "8 cm"],
				["preferred_dates", "November"],
				["budget", "5k"],
			];
			for (const [column, value] of restored) {
				await assert.rejects(
					() =>
						withTransaction((inner) =>
							updateRow(inner, "inquiries", id, { [column]: value }),
						),
					new RegExp(`inquiries_guard_update: ${column} cannot change`),
				);
			}

			// Setting the marker alone is the transition and is allowed; the scrub
			// columns are frozen from then on. This inquiry kept its phone, so the
			// inquiries_contact_phone_unless_anonymized check is not what stops
			// clearing the marker.
			const kept = idOf(
				await insertRow(trx, "inquiries", newInquiry(a.id, clientA.id)),
			);
			await updateRow(trx, "inquiries", kept, { anonymized_at: new Date() });
			await assert.rejects(
				() =>
					withTransaction((inner) =>
						updateRow(inner, "inquiries", kept, { anonymized_at: null }),
					),
				/inquiries_guard_update: anonymized_at cannot change/,
			);
			await assert.rejects(
				() =>
					withTransaction((inner) =>
						updateRow(inner, "inquiries", kept, { idea: "[removed]" }),
					),
				/inquiries_guard_update: idea cannot change/,
			);
		});
	});

	test("a frozen column cannot change in the update that sets anonymized_at", async ({
		assert,
	}) => {
		const { a, clientA } = await twoTenants();
		const otherClient = await inTenant(a, () => makeClient(a));
		const attempts: [string, Record<string, unknown>][] = [
			["source_channel", { idea: "[removed]", source_channel: "google" }],
			["client_id", { client_id: otherClient.id }],
			["created_at", { created_at: new Date("2020-01-01") }],
		];

		await withDbContext({ tenantId: a.id }, async (trx) => {
			const id = idOf(
				await insertRow(trx, "inquiries", newInquiry(a.id, clientA.id)),
			);

			for (const [column, set] of attempts) {
				await assert.rejects(
					() =>
						withTransaction((inner) =>
							updateRow(inner, "inquiries", id, {
								...set,
								anonymized_at: new Date(),
							}),
						),
					new RegExp(`inquiries_guard_update: ${column} cannot change`),
				);
			}
		});
	});

	test("after anonymization the decision, deletion and updated_at are still free to change", async ({
		assert,
	}) => {
		const { a, clientA } = await twoTenants();

		await withDbContext({ tenantId: a.id }, async (trx) => {
			const id = idOf(
				await insertRow(trx, "inquiries", newInquiry(a.id, clientA.id)),
			);
			await updateRow(trx, "inquiries", id, { anonymized_at: new Date() });

			// A decision after anonymization (TAT-46) and a tenant soft delete
			// (which updates deleted_at on every live inquiry) must still work.
			await updateRow(trx, "inquiries", id, {
				status: "accepted",
				decided_at: new Date(),
			});
			await updateRow(trx, "inquiries", id, {
				status: "declined",
				decided_at: new Date(),
			});
			await updateRow(trx, "inquiries", id, { updated_at: new Date() });
			await updateRow(trx, "inquiries", id, { deleted_at: new Date() });
			await updateRow(trx, "inquiries", id, { deleted_at: null });

			const { rows } = await trx.rawQuery(
				"select status, decided_at, deleted_at, anonymized_at from inquiries where id = ?",
				[id],
			);
			assert.equal(rows[0].status, "declined");
			assert.isNotNull(rows[0].decided_at);
			assert.isNull(rows[0].deleted_at);
			assert.isNotNull(rows[0].anonymized_at);
		});
	});

	test("row-level security", async ({ assert }) => {
		await assertRowLevelSecurity(
			assert,
			"inquiries",
			async (tenant) => {
				const client = await inTenant(tenant, () => makeClient(tenant));
				return newInquiry(tenant.id, client.id);
			},
			// The guard trigger fires before the policy's WITH CHECK and names the column.
			/inquiries_guard_update: tenant_id cannot change/,
		);
	});
});

test.group("Inquiry model", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("accepting and declining go through save() and pass the guard", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const client = await makeClient(tenant);
			const accepted = await makeInquiry(tenant, client);
			const declined = await makeInquiry(tenant, client);

			accepted.merge({ status: "accepted", decidedAt: DateTime.utc() });
			await accepted.save();
			declined.merge({ status: "declined", decidedAt: DateTime.utc() });
			await declined.save();

			assert.equal((await Inquiry.findOrFail(accepted.id)).status, "accepted");
			assert.equal((await Inquiry.findOrFail(declined.id)).status, "declined");
		});
	});

	test("soft delete and restore pass the guard", async ({ assert }) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const inquiry = await makeInquiry(tenant, await makeClient(tenant));

			await inquiry.softDelete();
			assert.isEmpty(await Inquiry.query().where("tenant_id", tenant.id));
			await inquiry.restore();
			assert.lengthOf(await Inquiry.query().where("tenant_id", tenant.id), 1);
		});
	});

	test("every status and source channel in the model is accepted by the database", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const client = await makeClient(tenant);
			for (const sourceChannel of SOURCE_CHANNELS) {
				await makeInquiry(tenant, client, { sourceChannel });
			}
			for (const status of INQUIRY_STATUSES) {
				await makeInquiry(tenant, client, {
					status,
					decidedAt: status === "new" ? null : DateTime.utc(),
				});
			}
			assert.lengthOf(
				await Inquiry.query().where("tenant_id", tenant.id),
				SOURCE_CHANNELS.length + INQUIRY_STATUSES.length,
			);
		});
	});
});
