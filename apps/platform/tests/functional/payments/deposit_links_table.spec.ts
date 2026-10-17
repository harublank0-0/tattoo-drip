import { randomBytes } from "node:crypto";
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { withDbContext, withTransaction } from "#services/db_context";
import { makeClient, makeProject } from "#tests/helpers/pipeline";
import { assertRowLevelSecurity } from "#tests/helpers/rls";
import { insertRow } from "#tests/helpers/sql";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

/** A random reference code from the alphabet. */
const code = () =>
	Array.from(
		{ length: 6 },
		() => ALPHABET[Math.floor(Math.random() * ALPHABET.length)],
	).join("");

/** A link row's columns with fresh unique values; `over` replaces any. */
function linkValues(
	tenantId: string,
	projectId: string,
	over: Record<string, unknown> = {},
) {
	return {
		tenant_id: tenantId,
		project_id: projectId,
		reference_code: code(),
		token_nonce: randomBytes(16).toString("base64url"),
		token_hash: randomBytes(32).toString("hex"),
		expires_at: new Date(Date.now() + 86_400_000),
		...over,
	};
}

const projectIn = (tenant: { id: string }) =>
	inTenant(tenant, async () =>
		makeProject(tenant, await makeClient(tenant), {
			status: "deposit_pending",
		}),
	);

test.group("deposit_links table", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("row-level security keeps each studio's links to itself", async ({
		assert,
	}) => {
		await assertRowLevelSecurity(assert, "deposit_links", async (tenant) =>
			linkValues(tenant.id, (await projectIn(tenant)).id),
		);
	});

	test("a link points only at its own studio's project", async ({ assert }) => {
		const { tenant: a } = await studioWithOwner("links-a-65");
		const { tenant: b } = await studioWithOwner("links-b-65");
		const theirs = await projectIn(b);

		await withDbContext({ tenantId: a.id }, async () => {
			await assert.rejects(
				() =>
					withTransaction((inner) =>
						insertRow(inner, "deposit_links", linkValues(a.id, theirs.id)),
					),
				/deposit_links_tenant_id_project_id_foreign/,
			);
		});
	});

	test("one link per project, one code per studio, one row per token hash", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("links-unique-65");
		const first = await projectIn(tenant);
		const second = await projectIn(tenant);
		const taken = linkValues(tenant.id, first.id);

		await withDbContext({ tenantId: tenant.id }, async (trx) => {
			await insertRow(trx, "deposit_links", taken);
			const rejects = (values: Record<string, unknown>, message: RegExp) =>
				assert.rejects(
					() =>
						withTransaction((inner) =>
							insertRow(inner, "deposit_links", values),
						),
					message,
				);

			await rejects(
				linkValues(tenant.id, first.id),
				/deposit_links_tenant_id_project_id_unique/,
			);
			await rejects(
				linkValues(tenant.id, second.id, {
					reference_code: taken.reference_code,
				}),
				/deposit_links_tenant_id_reference_code_unique/,
			);
			await rejects(
				linkValues(tenant.id, second.id, { token_hash: taken.token_hash }),
				/deposit_links_token_hash_unique/,
			);
			// The positive control: a second project with its own values is fine.
			await insertRow(trx, "deposit_links", linkValues(tenant.id, second.id));
		});
	});

	test("the code, the nonce and the hash keep their shapes", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("links-format-65");
		const project = await projectIn(tenant);
		const cases: [Record<string, unknown>, string][] = [
			// 1 and O are not in the alphabet.
			[{ reference_code: "ABC12O" }, "deposit_links_reference_code_format"],
			[{ reference_code: "abcdef" }, "deposit_links_reference_code_format"],
			[{ reference_code: "ABCDE" }, "deposit_links_reference_code_format"],
			[{ token_nonce: "short" }, "deposit_links_token_nonce_format"],
			[
				{ token_nonce: `${"a".repeat(21)}=` },
				"deposit_links_token_nonce_format",
			],
			[{ token_hash: "A".repeat(64) }, "deposit_links_token_hash_format"],
			[{ token_hash: "a".repeat(63) }, "deposit_links_token_hash_format"],
		];

		await withDbContext({ tenantId: tenant.id }, async () => {
			for (const [over, constraint] of cases) {
				await assert.rejects(
					() =>
						withTransaction((inner) =>
							insertRow(
								inner,
								"deposit_links",
								linkValues(tenant.id, project.id, over),
							),
						),
					new RegExp(constraint),
				);
			}
		});
	});
});
