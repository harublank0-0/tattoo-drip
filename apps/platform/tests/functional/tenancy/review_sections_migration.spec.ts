import db from "@adonisjs/lucid/services/db";
import type { TransactionClientContract } from "@adonisjs/lucid/types/database";
import { test } from "@japa/runner";
import ReviewSections from "#database/migrations/1791950000001_add_review_sections_to_tenants";
import { DEFAULT_SECTIONS } from "#modules/storefront/look";

/**
 * The Fresh ink and Reviews sections migration (Reviews and Fresh ink, slice
 * 3), run for real inside a transaction that is rolled back. The column
 * `storefront_sections` is varchar(100) and its check allowed one to eight
 * lowercase keys with `inquiry` among them, repeated and unknown keys
 * included; this migration widens the check for `fresh_ink`'s underscore and
 * puts both keys into every list.
 */

type Migration = new (
	client: TransactionClientContract,
	file: string,
	dryRun?: boolean,
) => { execUp(): Promise<unknown>; execDown(): Promise<unknown> };

const run = (trx: TransactionClientContract, direction: "up" | "down") => {
	const migration = new (ReviewSections as unknown as Migration)(
		trx,
		"test",
		false,
	);
	return direction === "up" ? migration.execUp() : migration.execDown();
};

const READ_DEFAULT =
	"select column_default from information_schema.columns where table_name = 'tenants' and column_name = 'storefront_sections'";

/** Inserts studios with these stored lists; their slugs are `mig-rs-<n>` (read in text order, so at most ten). */
async function seed(trx: TransactionClientContract, lists: string[]) {
	for (const [index, list] of lists.entries()) {
		await trx.rawQuery(
			"insert into tenants (type, name, slug, created_at, storefront_sections) values ('studio', ?, ?, now(), ?)",
			[`Migration ${index}`, `mig-rs-${index}`, list],
		);
	}
}

async function lists(trx: TransactionClientContract): Promise<string[]> {
	const { rows } = await trx.rawQuery(
		"select storefront_sections from tenants where slug like 'mig-rs-%' order by slug",
	);
	return rows.map(
		(row: { storefront_sections: string }) => row.storefront_sections,
	);
}

/** Runs `work` in a transaction on the owner connection and always rolls it back. */
async function rolledBack(
	work: (trx: TransactionClientContract) => Promise<void>,
) {
	const trx = await db.connection("owner").transaction();
	try {
		await work(trx);
	} finally {
		await trx.rollback();
	}
}

test.group("the Fresh ink and Reviews sections migration (slice 3)", () => {
	test("up and down keep every list within the column's check, boundary lists included", async ({
		assert,
	}) => {
		await rolledBack(async (trx) => {
			// Start from the state before this migration.
			await run(trx, "down");
			assert.include(
				(await trx.rawQuery(READ_DEFAULT)).rows[0].column_default,
				"'work,artists,flash,info,inquiry'",
			);
			const stored = [
				"work,artists,flash,info,inquiry", // the default before it
				"work,artists,inquiry", // no Good to know: before the form
				"inquiry,work,info", // the form first
				"info,inquiry,artists",
				"work,work,artists,artists,info,zzz,zzz,inquiry", // eight keys, repeats and unknown ones
				`work,artists,${"x".repeat(79)},inquiry`, // a hundred characters
			];
			await seed(trx, stored);
			assert.deepEqual(await lists(trx), stored);

			await run(trx, "up");

			// Fresh ink and Reviews go right before Good to know, else before the form.
			assert.deepEqual(await lists(trx), [
				"work,artists,flash,fresh_ink,reviews,info,inquiry",
				"work,artists,fresh_ink,reviews,inquiry",
				"inquiry,work,fresh_ink,reviews,info",
				"fresh_ink,reviews,info,inquiry,artists",
				"work,artists,fresh_ink,reviews,info,inquiry",
				"work,artists,fresh_ink,reviews,inquiry",
			]);
			assert.include(
				(await trx.rawQuery(READ_DEFAULT)).rows[0].column_default,
				`'${DEFAULT_SECTIONS.join(",")}'`,
			);

			// A list that already holds one of them (only a development database
			// can) gets the other, and one with both keeps its order.
			await trx.rawQuery(
				"update tenants set storefront_sections = 'reviews,work,inquiry' where slug = 'mig-rs-0'",
			);
			await trx.rawQuery(
				"update tenants set storefront_sections = 'reviews,work,fresh_ink,inquiry' where slug = 'mig-rs-1'",
			);
			await run(trx, "up");
			const [first, second] = await lists(trx);
			assert.equal(first, "reviews,work,fresh_ink,inquiry");
			assert.equal(second, "reviews,work,fresh_ink,inquiry");

			await run(trx, "down");

			assert.deepEqual(await lists(trx), [
				"work,inquiry",
				"work,inquiry",
				"inquiry,work,info",
				"info,inquiry,artists",
				"work,artists,info,inquiry",
				"work,artists,inquiry",
			]);
			assert.include(
				(await trx.rawQuery(READ_DEFAULT)).rows[0].column_default,
				"'work,artists,flash,info,inquiry'",
			);
			// The old check is back: an underscore is refused again.
			await assert.rejects(
				() =>
					trx.rawQuery(
						"update tenants set storefront_sections = 'fresh_ink,inquiry' where slug = 'mig-rs-0'",
					),
				/tenants_storefront_sections_format/,
			);
		});
	});

	test("after it, the check takes `fresh_ink` and still refuses a key that starts with an underscore", async ({
		assert,
	}) => {
		await rolledBack(async (trx) => {
			await seed(trx, ["work,inquiry"]);
			await trx.rawQuery(
				"update tenants set storefront_sections = 'fresh_ink,reviews,inquiry' where slug = 'mig-rs-0'",
			);
			assert.deepEqual(await lists(trx), ["fresh_ink,reviews,inquiry"]);
			await assert.rejects(
				() =>
					trx.rawQuery(
						"update tenants set storefront_sections = '_x,inquiry' where slug = 'mig-rs-0'",
					),
				/tenants_storefront_sections_format/,
			);
		});
	});
});
