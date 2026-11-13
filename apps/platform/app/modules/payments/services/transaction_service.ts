import { DateTime } from "luxon";
import {
	MAX_EXPORT_ROWS,
	PER_PAGE,
	periodOf,
	type Totals,
	type TransactionFilters,
	type TransactionRecord,
} from "#modules/payments/transactions";
import type Tenant from "#modules/tenancy/models/tenant";
import { dbClient } from "#services/db_context";

type TenantRef = Pick<Tenant, "id">;

/**
 * Every customer-side money record of one studio, in one list
 * (docs/payments-paybridgenp.md): the payments ledger (desk payments,
 * verified screenshots, online deposits, refunds, reversals), online
 * payments not recorded in it (failed, or held for review) and online
 * checkouts not paid. Only this studio's rows: every query names the
 * tenant, under the request's row-level security. TattooDrip's own
 * subscription billing is another module and never appears here.
 */
export default class TransactionService {
	async page(
		tenant: TenantRef,
		filters: TransactionFilters,
		timezone: string,
	): Promise<{ rows: TransactionRecord[]; total: number }> {
		const { sql, bindings } = rowsQuery(tenant, filters, timezone, true);
		const { rows } = await dbClient().rawQuery(
			`${sql} order by r.occurred_at desc, r.id desc limit ? offset ?`,
			[...bindings, PER_PAGE, (filters.page - 1) * PER_PAGE],
		);
		return {
			rows: rows.map(toRecord),
			total: rows.length ? Number(rows[0].total) : 0,
		};
	}

	/** The filtered rows for the CSV, newest first, at most MAX_EXPORT_ROWS. */
	async export(
		tenant: TenantRef,
		filters: TransactionFilters,
		timezone: string,
	): Promise<TransactionRecord[]> {
		const { sql, bindings } = rowsQuery(tenant, filters, timezone, true);
		const { rows } = await dbClient().rawQuery(
			`${sql} order by r.occurred_at desc, r.id desc limit ?`,
			[...bindings, MAX_EXPORT_ROWS],
		);
		return rows.map(toRecord);
	}

	/**
	 * The period's totals per currency: collected (gross), refunds,
	 * reversals, pending, started and held for review. Only the period and
	 * the provider filter apply: the totals define their own statuses.
	 */
	async totals(
		tenant: TenantRef,
		filters: TransactionFilters,
		timezone: string,
	): Promise<Totals[]> {
		const { sql, bindings } = rowsQuery(tenant, filters, timezone, false);
		const { rows } = await dbClient().rawQuery(
			`select r.currency,
				coalesce(sum(r.amount) filter (where r.source = 'ledger' and r.status = 'succeeded' and r.type in ('deposit', 'session', 'balance')), 0) as gross,
				count(*) filter (where r.source = 'ledger' and r.status = 'succeeded' and r.type in ('deposit', 'session', 'balance')) as collected_count,
				coalesce(-sum(r.amount) filter (where r.source = 'ledger' and r.status = 'succeeded' and r.type = 'refund'), 0) as refunds,
				coalesce(sum(r.amount) filter (where r.source = 'ledger' and r.status = 'succeeded' and r.type = 'reversal'), 0) as reversals,
				coalesce(sum(r.amount) filter (where r.status = 'pending' and r.source <> 'online_checkout'), 0) as pending,
				coalesce(sum(r.amount) filter (where r.status = 'pending' and r.source = 'online_checkout'), 0) as started,
				coalesce(sum(r.amount) filter (where r.status = 'review'), 0) as review
			 from (${sql}) r
			 group by r.currency
			 order by r.currency = 'NPR' desc, r.currency`,
			bindings,
		);
		return rows.map((row: Record<string, string>) => ({
			currency: row.currency,
			gross: Number(row.gross),
			collectedCount: Number(row.collected_count),
			refunds: Number(row.refunds),
			reversals: Number(row.reversals),
			pending: Number(row.pending),
			started: Number(row.started),
			review: Number(row.review),
		}));
	}

	/** Collected and refunded per day of the period, in the studio's days (NPR only). */
	async daily(
		tenant: TenantRef,
		filters: TransactionFilters,
		timezone: string,
	): Promise<{ day: string; collected: number; refunded: number }[]> {
		const { sql, bindings } = rowsQuery(tenant, filters, timezone, false);
		const { rows } = await dbClient().rawQuery(
			`select to_char(r.occurred_at at time zone ?, 'YYYY-MM-DD') as day,
				coalesce(sum(r.amount) filter (where r.type in ('deposit', 'session', 'balance')), 0) as collected,
				coalesce(-sum(r.amount) filter (where r.type = 'refund'), 0) as refunded
			 from (${sql}) r
			 where r.source = 'ledger' and r.status = 'succeeded' and r.currency = 'NPR'
			 group by 1
			 order by 1`,
			[timezone, ...bindings],
		);
		return rows.map((row: Record<string, string>) => ({
			day: row.day,
			collected: Number(row.collected),
			refunded: Number(row.refunded),
		}));
	}

	/** One online checkout of the studio, for "Check status". */
	async checkoutIdFor(tenant: TenantRef, id: string): Promise<string | null> {
		const { rows } = await dbClient().rawQuery(
			`select gc.id from gateway_checkouts gc where gc.tenant_id = ? and gc.id = ?
			 union all
			 select gp.checkout_id from gateway_payments gp where gp.tenant_id = ? and (gp.id = ? or gp.payment_id = ?)
			 limit 1`,
			[tenant.id, id, tenant.id, id, id],
		);
		return rows[0]?.id ?? rows[0]?.checkout_id ?? null;
	}
}

/**
 * The rows of the period as one subquery `r`. With `all` the status, type
 * and search filters apply too (the list and the export); without, only
 * the period and the provider (the totals).
 */
function rowsQuery(
	tenant: TenantRef,
	filters: TransactionFilters,
	timezone: string,
	all: boolean,
): { sql: string; bindings: (string | number)[] } {
	const period = periodOf(filters.from, filters.to, timezone);
	const id = tenant.id;
	const bindings: (string | number)[] = [id, id, id, id, id, id, id];
	const where = ["r.occurred_at >= ?", "r.occurred_at < ?"];
	bindings.push(
		period.startsAt.toISO() as string,
		period.endsBefore.toISO() as string,
	);
	if (filters.provider) {
		where.push("r.provider = ?");
		bindings.push(filters.provider);
	}
	if (all && filters.status) {
		where.push("r.status = ?");
		bindings.push(filters.status);
	}
	if (all && filters.type) {
		where.push("r.type = ?");
		bindings.push(filters.type);
	}
	if (all && filters.q) {
		const like = `%${filters.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
		where.push(
			"(c.name ilike ? or t.brief ilike ? or r.provider_ref ilike ? or r.provider_id ilike ?)",
		);
		bindings.push(like, like, like, like);
	}
	const sql = `select r.*, t.brief as project_brief, t.client_id, c.name as client_name, count(*) over () as total
		from (
			select p.id::text as id, 'ledger' as source,
				case p.kind when 'correction' then 'reversal' else p.kind::text end as type,
				case p.status when 'verified' then 'succeeded' when 'submitted' then 'pending' else 'rejected' end as status,
				p.method::text as provider,
				(gp.id is not null or gr.id is not null) as online,
				p.amount::bigint as amount, p.currency,
				p.created_at, p.verified_at as settled_at,
				coalesce(p.verified_at, p.created_at) as occurred_at,
				p.project_id, p.note,
				gp.provider_ref,
				coalesce(gp.provider_payment_id, gr.provider_refund_id) as provider_id,
				null::text as failure_reason, null::text as review_reason,
				coalesce(gp.refunded_amount, 0) as online_refunded,
				gp.checkout_id::text as checkout_id
			from payments p
			left join gateway_payments gp on gp.tenant_id = p.tenant_id and gp.payment_id = p.id
			left join gateway_refunds gr on gr.tenant_id = p.tenant_id and gr.payment_id = p.id
			where p.tenant_id = ?
			union all
			select gp.id::text, 'online_payment', g.purpose,
				case when gp.review_reason is not null then 'review'
					when gp.status in ('failed', 'cancelled') then 'failed'
					else 'pending' end,
				gp.method, true, gp.amount::bigint, gp.currency,
				gp.created_at, null, gp.created_at,
				gp.project_id, null, gp.provider_ref, gp.provider_payment_id,
				gp.failure_reason, gp.review_reason, gp.refunded_amount,
				gp.checkout_id::text
			from gateway_payments gp
			join gateway_checkouts g on g.tenant_id = gp.tenant_id and g.id = gp.checkout_id
			where gp.tenant_id = ? and gp.payment_id is null
			union all
			select gc.id::text, 'online_checkout', gc.purpose,
				case when gc.status in ('creating', 'open') then 'pending'
					when gc.status = 'failed' then 'failed'
					else 'expired' end,
				null, true, gc.amount::bigint, gc.currency,
				gc.created_at, null, gc.created_at,
				gc.project_id, null, null, gc.provider_session_id,
				gc.failure_reason, null, 0, gc.id::text
			from gateway_checkouts gc
			where gc.tenant_id = ? and gc.status not in ('paid', 'superseded')
				and not exists (
					select 1 from gateway_payments g2
					where g2.tenant_id = ? and g2.checkout_id = gc.id
				)
		) r
		left join tattoo_projects t on t.tenant_id = ? and t.id = r.project_id
		left join clients c on c.tenant_id = ? and c.id = t.client_id and c.tenant_id = ?
		where ${where.join(" and ")}`;
	return { sql, bindings };
}

function toRecord(row: Record<string, unknown>): TransactionRecord {
	const instant = (value: unknown) =>
		value instanceof Date
			? DateTime.fromJSDate(value).toUTC()
			: DateTime.fromISO(String(value), { zone: "utc" });
	return {
		id: String(row.id),
		source: row.source as TransactionRecord["source"],
		type: row.type as TransactionRecord["type"],
		status: row.status as TransactionRecord["status"],
		provider: (row.provider as string | null) ?? null,
		online: row.online === true,
		amount: Number(row.amount),
		currency: String(row.currency),
		createdAt: instant(row.created_at),
		settledAt: row.settled_at ? instant(row.settled_at) : null,
		occurredAt: instant(row.occurred_at),
		projectId: String(row.project_id),
		projectBrief: (row.project_brief as string | null) ?? null,
		clientId: (row.client_id as string | null) ?? null,
		clientName: (row.client_name as string | null) ?? null,
		note: (row.note as string | null) ?? null,
		providerRef: (row.provider_ref as string | null) ?? null,
		providerId: (row.provider_id as string | null) ?? null,
		failureReason: (row.failure_reason as string | null) ?? null,
		reviewReason: (row.review_reason as string | null) ?? null,
		onlineRefunded: Number(row.online_refunded ?? 0),
		checkoutId: (row.checkout_id as string | null) ?? null,
	};
}
