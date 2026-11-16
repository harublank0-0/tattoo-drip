import { randomUUID } from "node:crypto";
import app from "@adonisjs/core/services/app";
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import User from "#models/user";
import { type HistoryFilters, monthOf } from "#modules/design_lab/history";
import DesignGeneration from "#modules/design_lab/models/design_generation";
import DesignProject from "#modules/design_lab/models/design_project";
import DesignUsageRecord from "#modules/design_lab/models/design_usage_record";
import DesignHistoryService from "#modules/design_lab/services/design_history_service";
import DesignUsageService from "#modules/design_lab/services/design_usage_service";
import type Tenant from "#modules/tenancy/models/tenant";
import TenantMembership from "#modules/tenancy/models/tenant_membership";
import {
	designProvider,
	sampleInputs,
	seedDesignLab,
} from "#tests/helpers/design_lab";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";

const thisMonth = () => monthOf(DateTime.utc());

const filters = (over: Partial<HistoryFilters> = {}): HistoryFilters => ({
	month: thisMonth(),
	artist: null,
	status: null,
	page: 1,
	...over,
});

async function labStudio(slug: string) {
	const { owner, tenant } = await studioWithOwner(slug, `Studio ${slug}`);
	const artist = await artistIn(tenant, `artist@${slug}.example`);
	const seeded = await seedDesignLab(tenant, artist);
	return { owner, tenant, artist, ...seeded };
}

/** A new generation in `projectId`, made by `userId`. */
function generation(
	tenant: Tenant,
	projectId: string,
	userId: string,
	over: Partial<{
		attempt: number;
		status: "queued" | "completed" | "failed" | "moderated";
	}> = {},
) {
	const status = over.status ?? "failed";
	return inTenant(tenant, () =>
		DesignGeneration.create({
			tenantId: tenant.id,
			designProjectId: projectId,
			createdBy: userId,
			requestId: randomUUID(),
			variantIndex: 0,
			provider: designProvider.name,
			model: designProvider.model,
			promptVersion: "tattoo-concept-v1",
			inputs: sampleInputs(),
			acceptedAt: DateTime.now(),
			status,
			attempt: over.attempt ?? 1,
			step: 3,
			failureCode:
				status === "moderated"
					? "content_moderated"
					: status === "failed"
						? "provider_error"
						: null,
			finishedAt: status === "queued" ? null : DateTime.now(),
		}),
	);
}

/** One ledger row: an attempt of `generationId`. */
function attempt(
	tenant: Tenant,
	row: {
		generationId: string;
		attempt?: number;
		userId: string | null;
		status: "reserved" | "settled" | "released";
		releaseReason?: string;
		reservedAt?: DateTime;
	},
) {
	const reservedAt = row.reservedAt ?? DateTime.now();
	return inTenant(tenant, () =>
		DesignUsageRecord.create({
			tenantId: tenant.id,
			generationId: row.generationId,
			attempt: row.attempt ?? 1,
			userId: row.userId,
			provider: designProvider.name,
			model: designProvider.model,
			units: 1,
			status: row.status,
			reservedAt,
			...(row.status === "settled" ? { settledAt: reservedAt } : {}),
			...(row.status === "released"
				? { releasedAt: reservedAt, releaseReason: row.releaseReason ?? null }
				: {}),
		} as Partial<DesignUsageRecord>),
	);
}

const service = () => app.container.make(DesignHistoryService);

test.group("Design Lab history service", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("lists every attempt of the month, newest first", async ({ assert }) => {
		const { tenant, artist, designProject } = await labStudio("hist-list");
		const g = await generation(tenant, designProject.id, artist.id, {
			status: "moderated",
		});
		await attempt(tenant, {
			generationId: g.id,
			userId: artist.id,
			status: "released",
			releaseReason: "content_moderated",
			// The newest row, still inside this UTC month whatever the hour.
			reservedAt: DateTime.utc().endOf("month"),
		});
		const history = await service();
		const page = await inTenant(tenant, () => history.list(tenant, filters()));
		assert.lengthOf(page.entries, 3);
		assert.equal(page.entries[0].status, "blocked");
		assert.equal(page.entries[0].generation.id, g.id);
		assert.sameMembers(
			page.entries.slice(1).map((entry) => entry.status),
			["failed", "done"],
		);
		assert.equal(page.lastPage, 1);
		assert.equal(page.page, 1);
	});

	test("a failure retried into a success keeps both rows", async ({
		assert,
	}) => {
		const { tenant, artist, designProject } = await labStudio("hist-retry");
		const g = await generation(tenant, designProject.id, artist.id, {
			attempt: 2,
			status: "completed",
		});
		await attempt(tenant, {
			generationId: g.id,
			attempt: 1,
			userId: artist.id,
			status: "released",
			releaseReason: "timed_out",
			// Older than attempt 2, still inside this UTC month.
			reservedAt: DateTime.utc().startOf("month"),
		});
		await attempt(tenant, {
			generationId: g.id,
			attempt: 2,
			userId: artist.id,
			status: "settled",
		});
		const history = await service();
		const page = await inTenant(tenant, () => history.list(tenant, filters()));
		const mine = page.entries.filter((entry) => entry.generation.id === g.id);
		assert.deepEqual(
			mine.map((entry) => [entry.record.attempt, entry.status]),
			[
				[2, "done"],
				[1, "failed"],
			],
		);
	});

	test("each attempt sits in the month it was reserved", async ({ assert }) => {
		const { tenant, artist, designProject } = await labStudio("hist-month");
		const g = await generation(tenant, designProject.id, artist.id, {
			attempt: 2,
		});
		await attempt(tenant, {
			generationId: g.id,
			attempt: 1,
			userId: artist.id,
			status: "released",
			releaseReason: "timed_out",
			reservedAt: DateTime.fromISO("2026-10-31T23:30:00Z"),
		});
		await attempt(tenant, {
			generationId: g.id,
			attempt: 2,
			userId: artist.id,
			status: "released",
			releaseReason: "provider_error",
			reservedAt: DateTime.fromISO("2026-11-01T00:10:00Z"),
		});
		const history = await service();
		const october = await inTenant(tenant, () =>
			history.list(tenant, filters({ month: "2026-10" })),
		);
		assert.deepEqual(
			october.entries.map((entry) => entry.record.attempt),
			[1],
		);
		const november = await inTenant(tenant, () =>
			history.list(tenant, filters({ month: "2026-11" })),
		);
		assert.include(
			november.entries
				.filter((entry) => entry.generation.id === g.id)
				.map((entry) => entry.record.attempt),
			2,
		);
		assert.notInclude(
			november.entries
				.filter((entry) => entry.generation.id === g.id)
				.map((entry) => entry.record.attempt),
			1,
		);
	});

	test("counts match the allowance for the current month", async ({
		assert,
	}) => {
		const { tenant, artist, designProject } = await labStudio("hist-counts");
		const g = await generation(tenant, designProject.id, artist.id, {
			status: "queued",
		});
		await attempt(tenant, {
			generationId: g.id,
			userId: artist.id,
			status: "reserved",
		});
		const history = await service();
		const usage = await app.container.make(DesignUsageService);
		const counts = await inTenant(tenant, () =>
			history.counts(tenant, { month: thisMonth(), artist: null }),
		);
		const allowance = await inTenant(tenant, () => usage.allowance(tenant));
		assert.equal(counts.used, allowance.used);
		assert.equal(counts.inProgress, allowance.reserved);
		assert.deepEqual(counts, { used: 1, inProgress: 1, failed: 1, blocked: 0 });
	});

	test("filters by artist and status", async ({ assert }) => {
		const { tenant, artist, designProject } = await labStudio("hist-filter");
		const second = await artistIn(tenant, "second@hist-filter.example");
		const g = await generation(tenant, designProject.id, second.id, {
			status: "completed",
		});
		await attempt(tenant, {
			generationId: g.id,
			userId: second.id,
			status: "settled",
		});
		const history = await service();
		const theirs = await inTenant(tenant, () =>
			history.list(tenant, filters({ artist: second.id })),
		);
		assert.deepEqual(
			theirs.entries.map((entry) => entry.generation.id),
			[g.id],
		);
		const failed = await inTenant(tenant, () =>
			history.list(tenant, filters({ status: "failed" })),
		);
		assert.deepEqual(
			failed.entries.map((entry) => [entry.status, entry.record.releaseReason]),
			[["failed", "provider_error"]],
		);
		assert.isTrue(
			failed.entries.every((entry) => entry.record.userId === artist.id),
		);
		const counts = await inTenant(tenant, () =>
			history.counts(tenant, { month: thisMonth(), artist: second.id }),
		);
		assert.deepEqual(counts, { used: 1, inProgress: 0, failed: 0, blocked: 0 });
	});

	test("each status filter keeps only its ledger rows, and blocked counts", async ({
		assert,
	}) => {
		const { tenant, artist, designProject } = await labStudio("hist-status");
		const blocked = await generation(tenant, designProject.id, artist.id, {
			status: "moderated",
		});
		await attempt(tenant, {
			generationId: blocked.id,
			userId: artist.id,
			status: "released",
			releaseReason: "request_moderated",
		});
		const pending = await generation(tenant, designProject.id, artist.id, {
			status: "queued",
		});
		await attempt(tenant, {
			generationId: pending.id,
			userId: artist.id,
			status: "reserved",
		});
		const history = await service();
		const only = async (status: HistoryFilters["status"]) =>
			(
				await inTenant(tenant, () => history.list(tenant, filters({ status })))
			).entries.map((entry) => [entry.status, entry.record.status]);
		assert.deepEqual(await only("done"), [["done", "settled"]]);
		assert.deepEqual(await only("in_progress"), [["in_progress", "reserved"]]);
		assert.deepEqual(await only("blocked"), [["blocked", "released"]]);
		assert.deepEqual(await only("failed"), [["failed", "released"]]);
		const counts = await inTenant(tenant, () =>
			history.counts(tenant, { month: thisMonth(), artist: null }),
		);
		assert.deepEqual(counts, { used: 1, inProgress: 1, failed: 1, blocked: 1 });
	});

	test("pages 25 at a time", async ({ assert }) => {
		const { tenant, artist, designProject } = await labStudio("hist-pages");
		for (let i = 0; i < 28; i++) {
			const g = await generation(tenant, designProject.id, artist.id, {
				status: "completed",
			});
			await attempt(tenant, {
				generationId: g.id,
				userId: artist.id,
				status: "settled",
			});
		}
		// 28 here plus the seed's two: 30.
		const history = await service();
		const first = await inTenant(tenant, () => history.list(tenant, filters()));
		const second = await inTenant(tenant, () =>
			history.list(tenant, filters({ page: 2 })),
		);
		assert.lengthOf(first.entries, 25);
		assert.lengthOf(second.entries, 5);
		assert.equal(first.lastPage, 2);
	});

	test("a deleted project's rows stay, with no project", async ({ assert }) => {
		const { tenant, designProject } = await labStudio("hist-deleted");
		await inTenant(tenant, async () => {
			const project = await DesignProject.findOrFail(designProject.id);
			await project.softDelete();
		});
		const history = await service();
		const page = await inTenant(tenant, () => history.list(tenant, filters()));
		assert.lengthOf(page.entries, 2);
		assert.isTrue(page.entries.every((entry) => entry.project === null));
		const counts = await inTenant(tenant, () =>
			history.counts(tenant, { month: thisMonth(), artist: null }),
		);
		assert.equal(counts.used + counts.failed, 2);
	});

	test("people: live, former, re-invited and deleted accounts", async ({
		assert,
	}) => {
		const { tenant, artist, designProject } = await labStudio("hist-people");
		await User.query().where("id", artist.id).update({ full_name: "Sam Lee" });
		const nameless = await artistIn(tenant, "nameless@hist-people.example");
		const returning = await artistIn(tenant, "back@hist-people.example");
		await User.query()
			.where("id", returning.id)
			.update({ full_name: "Ana Back" });
		const removeMember = (userId: string) =>
			inTenant(tenant, async () => {
				const membership = await TenantMembership.query()
					.where("tenant_id", tenant.id)
					.where("user_id", userId)
					.firstOrFail();
				await membership.softDelete();
			});
		await removeMember(artist.id);
		await removeMember(nameless.id);
		await removeMember(returning.id);
		await inTenant(tenant, () =>
			TenantMembership.create({
				tenantId: tenant.id,
				userId: returning.id,
				role: "artist",
			}),
		);
		for (const userId of [nameless.id, returning.id, null]) {
			const g = await generation(
				tenant,
				designProject.id,
				userId ?? artist.id,
				{ status: "completed" },
			);
			await attempt(tenant, { generationId: g.id, userId, status: "settled" });
		}
		const history = await service();
		const page = await inTenant(tenant, () => history.list(tenant, filters()));
		const labelOf = (userId: string | null) =>
			page.entries.find((entry) => entry.record.userId === userId)?.person;
		assert.equal(labelOf(artist.id), "Sam Lee (former)");
		assert.equal(labelOf(nameless.id), "Former member");
		assert.equal(labelOf(returning.id), "Ana Back");
		assert.equal(labelOf(null), "Deleted account");
		// Former members' and deleted accounts' attempts still count: the
		// seed's two plus the three settled here.
		const counts = await inTenant(tenant, () =>
			history.counts(tenant, { month: thisMonth(), artist: null }),
		);
		assert.equal(counts.used + counts.failed, 5);
		const artists = await inTenant(tenant, () =>
			history.artists(tenant, thisMonth()),
		);
		assert.deepEqual(artists, [
			{ id: returning.id, label: "Ana Back" },
			{ id: nameless.id, label: "Former member" },
			{ id: artist.id, label: "Sam Lee (former)" },
		]);
	});

	test("another studio's rows never appear", async ({ assert }) => {
		const a = await labStudio("hist-iso-a");
		const b = await labStudio("hist-iso-b");
		const history = await service();
		const page = await inTenant(a.tenant, () =>
			history.list(a.tenant, filters({ artist: b.artist.id })),
		);
		assert.lengthOf(page.entries, 0);
		const counts = await inTenant(a.tenant, () =>
			history.counts(a.tenant, { month: thisMonth(), artist: b.artist.id }),
		);
		assert.deepEqual(counts, { used: 0, inProgress: 0, failed: 0, blocked: 0 });
		const artists = await inTenant(a.tenant, () =>
			history.artists(a.tenant, thisMonth()),
		);
		assert.deepEqual(
			artists.map((artist) => artist.id),
			[a.artist.id],
		);
		// Asked for B from A's context, the app's own filter finds nothing.
		const crossed = await inTenant(a.tenant, () =>
			history.list(b.tenant, filters()),
		);
		assert.lengthOf(crossed.entries, 0);
		const crossedCounts = await inTenant(a.tenant, () =>
			history.counts(b.tenant, { month: thisMonth(), artist: null }),
		);
		assert.deepEqual(crossedCounts, {
			used: 0,
			inProgress: 0,
			failed: 0,
			blocked: 0,
		});
		assert.deepEqual(
			await inTenant(a.tenant, () => history.artists(b.tenant, thisMonth())),
			[],
		);
		assert.isNull(await inTenant(a.tenant, () => history.firstMonth(b.tenant)));
	});
});
