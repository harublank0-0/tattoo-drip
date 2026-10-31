import testUtils from "@adonisjs/core/services/test_utils";
import db from "@adonisjs/lucid/services/db";
import type { TransactionClientContract } from "@adonisjs/lucid/types/database";
import { test } from "@japa/runner";
import * as ClaimedOnceFile from "#database/migrations/1791830000000_add_flash_claimed_once_to_tattoo_projects";
import ArtistService from "#modules/artists/services/artist_service";
import FlashDesign from "#modules/flash/models/flash_design";
import FlashService from "#modules/flash/services/flash_service";
import ImageService from "#modules/media/services/image_service";
import { dbClient } from "#services/db_context";
import { addArtist, addFlashDesign } from "#tests/helpers/artists";
import { ownerMember, paymentServices } from "#tests/helpers/payments";
import { makeClient, makeProject, makeQuote } from "#tests/helpers/pipeline";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

/**
 * The claim-once column's migration (TAT-129, part 4b review fix). A project
 * that reached its claim moment before the column existed (a design names it
 * as its claimer, it has a verified deposit, or it is or was booked) must be
 * marked by the migration, or its next deposit would claim the design again
 * after the studio made it available. Run for real in a transaction that is
 * rolled back: the state before the migration is the column dropped (down).
 */

type Migration = new (
	client: TransactionClientContract,
	file: string,
	dryRun?: boolean,
) => { execUp(): Promise<unknown>; execDown(): Promise<unknown> };

const run = (trx: TransactionClientContract, direction: "up" | "down") => {
	const migration = new (ClaimedOnceFile.default as unknown as Migration)(
		trx,
		"test",
		false,
	);
	return direction === "up" ? migration.execUp() : migration.execDown();
};

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

const one = async (
	trx: TransactionClientContract,
	sql: string,
	bindings: unknown[],
) => (await trx.rawQuery(sql, bindings as never)).rows[0].id as string;

test.group("the claim-once column's migration (TAT-129)", () => {
	test("up marks the projects that already reached their claim moment, and only those", async ({
		assert,
	}) => {
		await rolledBack(async (trx) => {
			const tenant = await one(
				trx,
				"insert into tenants (type, name, slug, created_at) values ('studio', 'Mig', 'mig-claimed-once', now()) returning id",
				[],
			);
			const client = await one(
				trx,
				"insert into clients (tenant_id, name, phone, created_at) values (?, 'Maya', '+9779800000001', now()) returning id",
				[tenant],
			);
			const artist = await one(
				trx,
				"insert into artists (tenant_id, name, slug, created_at) values (?, 'Sita', 'sita', now()) returning id",
				[tenant],
			);
			const design = async (n: number) =>
				one(
					trx,
					`insert into flash_designs (tenant_id, artist_id, image_key, width, height, name, size, one_of_a_kind, created_at)
					values (?, ?, ?, 100, 100, 'Moth', 'Small', true, now()) returning id`,
					[tenant, artist, `tenants/mig/flash_design/${n}.webp`],
				);
			const sharedDesign = await design(0);
			const project = (status: string, withDesign = true) =>
				one(
					trx,
					`insert into tattoo_projects (tenant_id, client_id, brief, status, flash_design_id, created_at)
					values (?, ?, 'A moth', ?, ?, now()) returning id`,
					[tenant, client, status, withDesign ? sharedDesign : null],
				);
			const payment = (
				projectId: string,
				kind: string,
				status: "verified" | "submitted" | "rejected",
			) =>
				trx.rawQuery(
					`insert into payments (tenant_id, project_id, kind, amount, method, status, verified_at, created_at)
					values (?, ?, ?, 100000, 'cash', ?, ${status === "submitted" ? "null" : "now()"}, now())`,
					[tenant, projectId, kind, status],
				);

			const named = await project("deposit_pending");
			await trx.rawQuery(
				"update flash_designs set claimed_at = now(), claimed_project_id = ? where id = ?",
				[named, sharedDesign],
			);
			const verified = await project("deposit_pending");
			await payment(verified, "deposit", "verified");
			const booked: Record<string, string> = {};
			for (const status of [
				"booked",
				"in_progress",
				"completed",
				"healing_check",
			]) {
				booked[status] = await project(status);
			}
			const waiting = await project("deposit_pending");
			await payment(waiting, "deposit", "submitted");
			const rejected = await project("deposit_pending");
			await payment(rejected, "deposit", "rejected");
			const sessionOnly = await project("quoted");
			await payment(sessionOnly, "session", "verified");
			const plain = await project("reviewing");
			const noDesign = await project("booked", false);

			await run(trx, "down"); // the state before the migration: no column
			await run(trx, "up");

			const marked = async (id: string) =>
				(
					await trx.rawQuery(
						"select flash_claimed_once_at is not null as marked from tattoo_projects where id = ?",
						[id],
					)
				).rows[0].marked as boolean;
			assert.isTrue(await marked(named), "named as a design's claimer");
			assert.isTrue(await marked(verified), "a verified deposit");
			for (const [status, id] of Object.entries(booked)) {
				assert.isTrue(await marked(id), `is ${status}`);
			}
			assert.isFalse(
				await marked(waiting),
				"a submitted deposit is not verified",
			);
			assert.isFalse(await marked(rejected), "a rejected deposit");
			assert.isFalse(
				await marked(sessionOnly),
				"a session payment is no claim moment",
			);
			assert.isFalse(await marked(plain), "nothing has happened to it");
			assert.isFalse(await marked(noDesign), "no design, nothing to claim");
		});
	});
});

test.group("after the claim-once migration (TAT-129)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a project claimed before the migration, backfilled, does not claim the design again after Make available", async ({
		assert,
	}) => {
		const { payments } = paymentServices();
		const { owner, tenant } = await studioWithOwner(
			"claim-migrated",
			"Migrated",
		);
		const member = ownerMember(owner);
		const artist = await addArtist(tenant, owner);
		const design = await inTenant(tenant, () =>
			addFlashDesign(tenant, artist, { oneOfAKind: true }),
		);
		const project = await inTenant(tenant, async () => {
			const made = await makeProject(tenant, await makeClient(tenant), {
				status: "deposit_pending",
				flashDesignId: design.id,
			});
			await makeQuote(tenant, made);
			return made;
		});
		const cash = (amount: number) => ({
			kind: "deposit" as const,
			method: "cash" as const,
			amount,
			note: null,
		});
		await inTenant(tenant, () =>
			payments.record(tenant, member, project, cash(100_000)),
		);
		// The state the migration finds: claimed under the old code, no mark.
		await inTenant(tenant, () =>
			dbClient().rawQuery(
				"update tattoo_projects set flash_claimed_once_at = null where id = ?",
				[project.id],
			),
		);
		for (const statement of ClaimedOnceFile.BACKFILL) {
			await inTenant(tenant, () => dbClient().rawQuery(statement));
		}

		const images = new ImageService();
		const flash = new FlashService(images, new ArtistService(images));
		await inTenant(tenant, () =>
			flash.setClaimed(
				tenant,
				{ userId: owner.id, role: "owner" },
				design,
				false,
			),
		);
		await inTenant(tenant, () =>
			payments.record(tenant, member, project, cash(200_000)),
		);

		const stored = await inTenant(tenant, () =>
			FlashDesign.findOrFail(design.id),
		);
		assert.isNull(stored.claimedAt, "the rest of the deposit did not undo it");
	});
});
