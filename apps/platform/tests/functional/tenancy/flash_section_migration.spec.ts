import db from "@adonisjs/lucid/services/db";
import type { TransactionClientContract } from "@adonisjs/lucid/types/database";
import { test } from "@japa/runner";
import WorkSection from "#database/migrations/1791700000002_add_work_section_to_tenants";
import GoodToKnowSection from "#database/migrations/1791790000001_add_good_to_know_section_to_tenants";
import FlashSection from "#database/migrations/1791800000001_add_flash_section_to_tenants";

/**
 * The Flash section migration (TAT-129), run for real inside a transaction
 * that is rolled back, alone and after TAT-126's and TAT-128's. The column
 * `storefront_sections` is varchar(100) and its check allows one to eight
 * lowercase keys with `inquiry` among them, repeated and unknown keys
 * included: lists the app never writes, but a migration that appended a key
 * to an eight-key or 100-character one would violate the check and abort.
 */

type Migration = new (
	client: TransactionClientContract,
	file: string,
	dryRun?: boolean,
) => { execUp(): Promise<unknown>; execDown(): Promise<unknown> };

const run = (
	Section: unknown,
	trx: TransactionClientContract,
	direction: "up" | "down",
) => {
	const migration = new (Section as Migration)(trx, "test", false);
	return direction === "up" ? migration.execUp() : migration.execDown();
};

const READ_DEFAULT =
	"select column_default from information_schema.columns where table_name = 'tenants' and column_name = 'storefront_sections'";

/** Inserts studios with these stored lists; their slugs are `mig-<n>` (at most ten, read in text order). */
async function seed(trx: TransactionClientContract, lists: string[]) {
	for (const [index, list] of lists.entries()) {
		await trx.rawQuery(
			"insert into tenants (type, name, slug, created_at, storefront_sections) values ('studio', ?, ?, now(), ?)",
			[`Migration ${index}`, `mig-${index}`, list],
		);
	}
}

async function lists(trx: TransactionClientContract): Promise<string[]> {
	const { rows } = await trx.rawQuery(
		"select storefront_sections from tenants where slug like 'mig-%' order by slug",
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

test.group("the Flash section migration (TAT-129)", () => {
	test("up and down keep every list within the column's check, boundary lists included", async ({
		assert,
	}) => {
		await rolledBack(async (trx) => {
			// Start from the state before this migration.
			await run(FlashSection, trx, "down");
			assert.include(
				(await trx.rawQuery(READ_DEFAULT)).rows[0].column_default,
				"'work,artists,info,inquiry'",
			);
			const stored = [
				"work,artists,info,inquiry", // the default: Flash is hidden (left out) until the migration
				"artists,info,inquiry",
				"work,info,inquiry",
				"work,inquiry",
				"inquiry,work,info",
				"info,inquiry,artists",
				"work,work,artists,artists,info,zzz,zzz,inquiry", // eight keys, repeats and unknown ones
				`work,artists,${"x".repeat(79)},inquiry`, // a hundred characters
				"flash,work,inquiry", // already holds flash (only a development database can)
				"flash,flash,info,work,artists,inquiry,zzz,zzz", // eight keys with flash
			];
			await seed(trx, stored);
			assert.deepEqual(await lists(trx), stored);

			await run(FlashSection, trx, "up");

			// Flash goes right after the artists, else before Good to know, else before the form.
			assert.deepEqual(await lists(trx), [
				"work,artists,flash,info,inquiry",
				"artists,flash,info,inquiry",
				"work,flash,info,inquiry",
				"work,flash,inquiry",
				"inquiry,work,flash,info",
				"info,inquiry,artists,flash",
				"work,artists,flash,info,inquiry",
				"work,artists,flash,inquiry",
				"flash,work,inquiry",
				"flash,info,work,artists,inquiry",
			]);
			assert.include(
				(await trx.rawQuery(READ_DEFAULT)).rows[0].column_default,
				"'work,artists,flash,info,inquiry'",
			);
			// The migration's own UPDATE would have thrown on a list the check refuses; say it too.
			const { rows } = await trx.rawQuery(
				"select count(*)::int as n from tenants where slug like 'mig-%' and (length(storefront_sections) > 100 or storefront_sections !~ '^[a-z]+(,[a-z]+){0,7}$' or not ('inquiry' = any (string_to_array(storefront_sections, ','))))",
			);
			assert.equal(rows[0].n, 0);

			await run(FlashSection, trx, "down");

			assert.deepEqual(await lists(trx), [
				"work,artists,info,inquiry",
				"artists,info,inquiry",
				"work,info,inquiry",
				"work,inquiry",
				"inquiry,work,info",
				"info,inquiry,artists",
				"work,artists,info,inquiry",
				"work,artists,inquiry",
				"work,inquiry",
				"info,work,artists,inquiry",
			]);
			assert.include(
				(await trx.rawQuery(READ_DEFAULT)).rows[0].column_default,
				"'work,artists,info,inquiry'",
			);
		});
	});

	test("through TAT-126's, TAT-128's and this migration in order, a list ends with flash after the artists", async ({
		assert,
	}) => {
		await rolledBack(async (trx) => {
			// Before all three: the column's first default, no work, no info, no flash.
			await run(FlashSection, trx, "down");
			await run(GoodToKnowSection, trx, "down");
			await run(WorkSection, trx, "down");
			assert.include(
				(await trx.rawQuery(READ_DEFAULT)).rows[0].column_default,
				"'artists,inquiry'",
			);
			const before = [
				"artists,inquiry",
				"inquiry",
				"inquiry,artists",
				"artists,artists,flash,inquiry",
				// A hundred characters: `work,` in front would make a hundred and five (the migrations rebuild the list).
				`artists,${"x".repeat(84)},inquiry`,
				"artists,artists,artists,artists,artists,flash,inquiry", // seven keys
				"artists,artists,flash,flash,zzz,zzz,www,inquiry", // eight keys, repeats and unknown ones
			];
			await seed(trx, before);

			await run(WorkSection, trx, "up");
			await run(GoodToKnowSection, trx, "up");
			await run(FlashSection, trx, "up");

			assert.deepEqual(await lists(trx), [
				"work,artists,flash,info,inquiry",
				"work,flash,info,inquiry",
				"work,info,inquiry,artists,flash",
				"work,artists,flash,info,inquiry",
				"work,artists,flash,info,inquiry",
				"work,artists,flash,info,inquiry",
				"work,artists,flash,info,inquiry",
			]);
			assert.include(
				(await trx.rawQuery(READ_DEFAULT)).rows[0].column_default,
				"'work,artists,flash,info,inquiry'",
			);

			// Rolling this one back leaves what TAT-128's migration made.
			await run(FlashSection, trx, "down");
			assert.deepEqual(await lists(trx), [
				"work,artists,info,inquiry",
				"work,info,inquiry",
				"work,info,inquiry,artists",
				"work,artists,info,inquiry",
				"work,artists,info,inquiry",
				"work,artists,info,inquiry",
				"work,artists,info,inquiry",
			]);
		});
	});

	// Like the two before it, this migration changes the default BEFORE it
	// rewrites the lists: ALTER TABLE holds its lock until the migration's
	// transaction ends, so a studio created meanwhile waits and takes the new
	// default. The other order would let one slip in between with the old
	// default and no `flash`, which the page reads as "Flash hidden".
	test("the default is the first statement of up and of down", async ({
		assert,
	}) => {
		for (const direction of ["up", "down"] as const) {
			const migration = new (
				FlashSection as unknown as new (
					client: unknown,
					file: string,
					dryRun: boolean,
				) => { execUp(): Promise<string[]>; execDown(): Promise<string[]> }
			)(db.connection("owner"), "test", true);
			const queries = await (direction === "up"
				? migration.execUp()
				: migration.execDown());

			assert.lengthOf(queries, 2, direction);
			assert.match(
				queries[0],
				/^alter table tenants alter column storefront_sections set default /,
				direction,
			);
			assert.match(queries[1], /update tenants/, direction);
		}
	});
});
