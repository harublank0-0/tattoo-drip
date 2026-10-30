import type { TransactionClientContract } from "@adonisjs/lucid/types/database";
import { DateTime } from "luxon";
import { todayIn } from "#modules/projects/quotes";
import { ClosureLimitError } from "#modules/scheduling/errors";
import StudioClosure from "#modules/scheduling/models/studio_closure";
import StudioHour from "#modules/scheduling/models/studio_hour";
import {
	type ClosureInput,
	MAX_UPCOMING_CLOSURES,
	type OpeningDay,
	type ShownClosure,
	WEEKDAYS,
} from "#modules/scheduling/opening_hours";
import type Tenant from "#modules/tenancy/models/tenant";
import { withTransaction } from "#services/db_context";

type TenantRef = Pick<Tenant, "id">;

/**
 * A studio's opening hours and closed days (TAT-128). Every call is scoped
 * to the tenant.
 *
 * Saves are serialized per studio with a transaction-level advisory lock
 * (`tattoo-drip:opening-hours:<tenant id>`), taken first in both writes:
 * replacing the week deletes the old rows and inserts the new ones, which
 * under a double submit would otherwise hit the weekday's unique index; and
 * the 20-entry cap counts exactly only when two adds cannot both count 19.
 * The lock is not on the tenant row because tenants change only through
 * TenancyService.
 *
 * Ended closed days stay in the table and are never listed.
 */
export default class OpeningHoursService {
	/** The open weekdays, Sunday first, times as "HH:mm". One query. */
	async week(tenant: TenantRef): Promise<OpeningDay[]> {
		const rows = await StudioHour.query()
			.where("tenant_id", tenant.id)
			.orderBy("weekday", "asc");
		return rows.map((row) => ({
			day: WEEKDAYS[row.weekday],
			opens: row.opensAt.slice(0, 5),
			closes: row.closesAt.slice(0, 5),
		}));
	}

	/** Replaces the whole week with `days` (validated: toOpeningWeek). */
	async replaceWeek(tenant: TenantRef, days: OpeningDay[]): Promise<void> {
		await withTransaction(async (trx) => {
			await lock(trx, tenant);
			await StudioHour.query({ client: trx })
				.where("tenant_id", tenant.id)
				.delete();
			if (days.length === 0) return;
			await StudioHour.createMany(
				days.map((day) => ({
					tenantId: tenant.id,
					weekday: WEEKDAYS.indexOf(day.day),
					opensAt: day.opens,
					closesAt: day.closes,
				})),
				{ client: trx },
			);
		});
	}

	/**
	 * The entries that have not ended on `today` (yyyy-MM-dd in the studio's
	 * timezone), earliest first, at most MAX_UPCOMING_CLOSURES. One query.
	 */
	async upcomingClosures(
		tenant: TenantRef,
		today: string,
	): Promise<StudioClosure[]> {
		return StudioClosure.query()
			.where("tenant_id", tenant.id)
			.where("ends_on", ">=", today)
			.orderBy("starts_on", "asc")
			.orderBy("ends_on", "asc")
			.orderBy("id", "asc")
			.limit(MAX_UPCOMING_CLOSURES);
	}

	/**
	 * Adds an entry (validated: toClosure). Throws ClosureLimitError when the
	 * studio already has MAX_UPCOMING_CLOSURES that have not ended on
	 * `today`; ended ones don't count.
	 */
	async addClosure(
		tenant: TenantRef,
		input: ClosureInput,
		today: string,
	): Promise<StudioClosure> {
		return withTransaction(async (trx) => {
			await lock(trx, tenant);
			const { rows } = await trx.rawQuery(
				"select count(*)::int as n from studio_closures where tenant_id = ? and ends_on >= ?",
				[tenant.id, today],
			);
			if ((rows[0].n as number) >= MAX_UPCOMING_CLOSURES) {
				throw new ClosureLimitError();
			}
			return StudioClosure.create(
				{
					tenantId: tenant.id,
					startsOn: DateTime.fromISO(input.startsOn),
					endsOn: DateTime.fromISO(input.endsOn),
					note: input.note,
				},
				{ client: trx },
			);
		});
	}

	/** One of the studio's entries; another studio's id is not found (E_ROW_NOT_FOUND). */
	async findClosure(tenant: TenantRef, id: string): Promise<StudioClosure> {
		return StudioClosure.query()
			.where("tenant_id", tenant.id)
			.where("id", id)
			.firstOrFail();
	}

	async removeClosure(
		tenant: TenantRef,
		closure: StudioClosure,
	): Promise<void> {
		await StudioClosure.query()
			.where("tenant_id", tenant.id)
			.where("id", closure.id)
			.delete();
	}

	/**
	 * What the public studio read carries (TAT-128): the week and the
	 * entries that have not ended in the studio's timezone, dates as
	 * yyyy-MM-dd. Two queries.
	 */
	async forPage(
		tenant: Pick<Tenant, "id" | "timezone">,
		now: DateTime = DateTime.now(),
	): Promise<{ openingHours: OpeningDay[]; closedDays: ShownClosure[] }> {
		const openingHours = await this.week(tenant);
		const closures = await this.upcomingClosures(
			tenant,
			todayIn(tenant.timezone, now),
		);
		return {
			openingHours,
			closedDays: closures.map((closure) => ({
				from: closure.startsOn.toISODate() as string,
				to: closure.endsOn.toISODate() as string,
				note: closure.note,
			})),
		};
	}
}

async function lock(trx: TransactionClientContract, tenant: TenantRef) {
	await trx.rawQuery("select pg_advisory_xact_lock(hashtextextended(?, 0))", [
		`tattoo-drip:opening-hours:${tenant.id}`,
	]);
}
