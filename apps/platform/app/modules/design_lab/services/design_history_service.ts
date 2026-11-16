import type { ModelQueryBuilderContract } from "@adonisjs/lucid/types/model";
import User from "#models/user";
import {
	HISTORY_PER_PAGE,
	type HistoryFilters,
	type HistoryStatus,
	historyStatus,
	monthOf,
	monthRange,
	personLabel,
} from "#modules/design_lab/history";
import DesignAsset from "#modules/design_lab/models/design_asset";
import DesignGeneration from "#modules/design_lab/models/design_generation";
import DesignProject from "#modules/design_lab/models/design_project";
import DesignUsageRecord from "#modules/design_lab/models/design_usage_record";
import { MODERATION_CODES } from "#modules/design_lab/rules";
import type Tenant from "#modules/tenancy/models/tenant";
import TenantMembership from "#modules/tenancy/models/tenant_membership";

type TenantRef = Pick<Tenant, "id">;

export type HistoryEntry = {
	record: DesignUsageRecord;
	status: HistoryStatus;
	generation: DesignGeneration;
	/** Null when the design project was deleted. */
	project: DesignProject | null;
	/** Only for done attempts. */
	asset: DesignAsset | null;
	person: string;
};

export type HistoryCounts = {
	used: number;
	inProgress: number;
	failed: number;
	blocked: number;
};

export type HistoryArtist = { id: string; label: string };

type LedgerQuery = ModelQueryBuilderContract<
	typeof DesignUsageRecord,
	DesignUsageRecord
>;

/**
 * The owners' generation history (docs/design-lab.md, "History"): the
 * usage ledger, one row per attempt, so its counts are the allowance's.
 * Every filter is a ledger column; the rows' generations, projects (deleted
 * ones too), images and people are loaded for the page only. Every query
 * names the tenant, under the request's RLS context.
 */
export default class DesignHistoryService {
	async list(
		tenant: TenantRef,
		filters: HistoryFilters,
	): Promise<{ entries: HistoryEntry[]; page: number; lastPage: number }> {
		const query = this.ledger(tenant, filters);
		if (filters.status) withStatus(query, filters.status);
		const page = await query
			.orderBy("reserved_at", "desc")
			.orderBy("id", "desc")
			.paginate(filters.page, HISTORY_PER_PAGE);
		const records = page.all();
		const generationIds = unique(records.map((record) => record.generationId));
		const generations = byId(
			generationIds.length === 0
				? []
				: await DesignGeneration.query()
						.where("tenant_id", tenant.id)
						.whereIn("id", generationIds),
		);
		const projectIds = unique(
			[...generations.values()].map((generation) => generation.designProjectId),
		);
		const projects = byId(
			projectIds.length === 0
				? []
				: await DesignProject.withTrashed()
						.where("tenant_id", tenant.id)
						.whereIn("id", projectIds),
		);
		const assets = new Map(
			(records.length === 0
				? []
				: await DesignAsset.query()
						.where("tenant_id", tenant.id)
						.whereIn("generation_id", generationIds)
			).map((asset) => [asset.generationId, asset]),
		);
		const people = await this.people(
			tenant,
			records.map((record) => record.userId),
		);
		const entries = records.flatMap((record) => {
			const generation = generations.get(record.generationId);
			if (!generation) return [];
			const project = projects.get(generation.designProjectId) ?? null;
			const status = historyStatus(record.status, record.releaseReason);
			return [
				{
					record,
					status,
					generation,
					project: project && project.deletedAt === null ? project : null,
					asset:
						status === "done"
							? (assets.get(record.generationId) ?? null)
							: null,
					person: people(record.userId),
				},
			];
		});
		return { entries, page: page.currentPage, lastPage: page.lastPage };
	}

	/** The month's units by status, as the allowance sums them. */
	async counts(
		tenant: TenantRef,
		filters: Pick<HistoryFilters, "month" | "artist">,
	): Promise<HistoryCounts> {
		const rows = (await this.ledger(tenant, filters)
			.groupBy("status", "release_reason")
			.select("status", "release_reason")
			.sum("units as total_units")) as unknown as {
			status: string;
			releaseReason: string | null;
			$extras: { total_units: string | number };
		}[];
		const counts: HistoryCounts = {
			used: 0,
			inProgress: 0,
			failed: 0,
			blocked: 0,
		};
		const key: Record<HistoryStatus, keyof HistoryCounts> = {
			done: "used",
			in_progress: "inProgress",
			failed: "failed",
			blocked: "blocked",
		};
		for (const row of rows) {
			counts[key[historyStatus(row.status, row.releaseReason)]] += Number(
				row.$extras.total_units,
			);
		}
		return counts;
	}

	/** Everyone with an attempt in the month (former members too), by label. */
	async artists(tenant: TenantRef, month: string): Promise<HistoryArtist[]> {
		const rows = await this.ledger(tenant, { month, artist: null })
			.whereNotNull("user_id")
			.distinct("user_id");
		const ids = rows.flatMap((row) => (row.userId ? [row.userId] : []));
		const label = await this.people(tenant, ids);
		return ids
			.map((id) => ({ id, label: label(id) }))
			.sort((a, b) => a.label.localeCompare(b.label));
	}

	/** "YYYY-MM" of the studio's first attempt, else null. */
	async firstMonth(tenant: TenantRef): Promise<string | null> {
		const first = await DesignUsageRecord.query()
			.where("tenant_id", tenant.id)
			.orderBy("reserved_at", "asc")
			.first();
		return first ? monthOf(first.reservedAt) : null;
	}

	private ledger(
		tenant: TenantRef,
		{ month, artist }: Pick<HistoryFilters, "month" | "artist">,
	): LedgerQuery {
		const { start, end } = monthRange(month);
		const query = DesignUsageRecord.query()
			.where("tenant_id", tenant.id)
			.where("reserved_at", ">=", start.toJSDate())
			.where("reserved_at", "<", end.toJSDate());
		if (artist) query.where("user_id", artist);
		return query;
	}

	/**
	 * Labels for the people behind these attempts: a member is former when
	 * none of their memberships here is live (a re-invited member is not).
	 */
	private async people(
		tenant: TenantRef,
		ids: (string | null)[],
	): Promise<(id: string | null) => string> {
		const wanted = [...new Set(ids.filter((id): id is string => id !== null))];
		if (wanted.length === 0) return () => personLabel(null, false);
		const users = new Map(
			(await User.query().whereIn("id", wanted)).map((user) => [user.id, user]),
		);
		const live = new Set(
			(
				await TenantMembership.withTrashed()
					.where("tenant_id", tenant.id)
					.whereIn("user_id", wanted)
			)
				.filter((membership) => membership.deletedAt === null)
				.map((membership) => membership.userId),
		);
		return (id) => {
			const user = id ? users.get(id) : undefined;
			return user
				? personLabel(
						{ fullName: user.fullName, email: user.email },
						!live.has(user.id),
					)
				: personLabel(null, false);
		};
	}
}

const unique = (ids: string[]) => [...new Set(ids)];

const byId = <T extends { id: string }>(rows: T[]) =>
	new Map(rows.map((row) => [row.id, row]));

/** The ledger rows behind one history status. */
function withStatus(query: LedgerQuery, status: HistoryStatus) {
	if (status === "done") query.where("status", "settled");
	else if (status === "in_progress") query.where("status", "reserved");
	else if (status === "blocked") {
		query
			.where("status", "released")
			.whereIn("release_reason", [...MODERATION_CODES]);
	} else {
		query.where("status", "released").where((inner) => {
			inner
				.whereNull("release_reason")
				.orWhereNotIn("release_reason", [...MODERATION_CODES]);
		});
	}
}
