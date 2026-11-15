import { DateTime } from "luxon";
import DesignUsageRecord from "#modules/design_lab/models/design_usage_record";
import { designLabSettings } from "#modules/design_lab/settings";
import type Tenant from "#modules/tenancy/models/tenant";
import { withTransaction } from "#services/db_context";

type TenantRef = Pick<Tenant, "id">;

/** The studio has no generations left this month. */
export class AllowanceError extends Error {
	constructor(
		readonly remaining: number,
		readonly limit: number,
	) {
		super(
			remaining === 0
				? `Your studio has used all ${limit} generations for this month. The allowance resets on the 1st.`
				: `Your studio has ${remaining} of ${limit} generations left this month: ask for ${remaining} or fewer.`,
		);
	}
}

/**
 * A member's burst limit: generation attempts (submits and retries alike) one
 * member may start in a short window. Released attempts still reach the
 * provider, so the monthly allowance alone does not bound provider calls.
 */
export const BURST_LIMIT = { attempts: 12, minutes: 10 };

/** Refused attempts a studio may have each month before new ones are refused, when the limit is lower. */
export const RELEASED_CAP = 10;

/** Another refusal of `reserve`, with words for the form. */
export class UsageLimitError extends Error {}

export type Allowance = {
	limit: number;
	/** Settled (stored images) this month. */
	used: number;
	/** Accepted and still running this month. */
	reserved: number;
	remaining: number;
	/** When the allowance resets: the first of next month, UTC, ISO. */
	resetsAt: string;
};

/**
 * The Design Lab allowance (docs/design-lab.md, Usage). TattooDrip pays the
 * provider; each studio may start DESIGN_LAB_MONTHLY_LIMIT generations a
 * calendar month (UTC). Every accepted generation attempt is one ledger row:
 * `reserved` when accepted (counted at once, so the limit holds while the
 * worker runs), `settled` once its image is stored, `released` (not counted)
 * when the provider failed, refused or moderated it. Settling and releasing
 * change only a `reserved` row, so a repeated job or retry never counts
 * twice, and reservations take a per-studio advisory lock, so two submits at
 * once cannot both take the last generation. Nothing the browser sends
 * decides a count, a cost or the limit.
 */
export default class DesignUsageService {
	/** The studio's allowance this month. */
	async allowance(tenant: TenantRef, now = DateTime.utc()): Promise<Allowance> {
		const { limit } = this.limitNow();
		const counts = await this.monthCounts(tenant, now);
		return {
			limit,
			used: counts.settled,
			reserved: counts.reserved,
			remaining: Math.max(0, limit - counts.settled - counts.reserved),
			resetsAt: monthStart(now).plus({ months: 1 }).toISO() ?? "",
		};
	}

	/**
	 * Reserves one unit for each generation attempt, all or none, in the
	 * caller's transaction (a savepoint): AllowanceError when they don't fit.
	 */
	async reserve(
		tenant: TenantRef,
		userId: string,
		attempts: {
			generationId: string;
			attempt: number;
			provider: string;
			model: string;
		}[],
		now = DateTime.utc(),
	): Promise<void> {
		await withTransaction(async (trx) => {
			await trx.rawQuery(
				"select pg_advisory_xact_lock(hashtextextended(?, 0))",
				[`design_usage:${tenant.id}`],
			);
			const { limit, creditsPerImage } = this.limitNow();
			const counts = await this.monthCounts(tenant, now);
			const remaining = Math.max(0, limit - counts.settled - counts.reserved);
			if (attempts.length > remaining) {
				throw new AllowanceError(remaining, limit);
			}
			// Failed and declined attempts give their unit back but were still
			// sent to the provider: at most RELEASED_CAP (or the limit, if higher)
			// of them a month, so a stream of refused requests can't run up
			// provider calls while still letting an artist rephrase.
			if (counts.released >= Math.max(limit, RELEASED_CAP)) {
				throw new UsageLimitError(
					"Too many generations failed or were declined by the safety filter this month. Contact TattooDrip if you need more.",
				);
			}
			const recent = await DesignUsageRecord.query()
				.where("tenant_id", tenant.id)
				.where("user_id", userId)
				.where(
					"reserved_at",
					">=",
					now.minus({ minutes: BURST_LIMIT.minutes }).toJSDate(),
				)
				.count("* as total")
				.first();
			if (
				Number(recent?.$extras.total ?? 0) + attempts.length >
				BURST_LIMIT.attempts
			) {
				throw new UsageLimitError(
					`You've started ${BURST_LIMIT.attempts} generations in the last ${BURST_LIMIT.minutes} minutes. Wait a few minutes and try again.`,
				);
			}
			for (const attempt of attempts) {
				await DesignUsageRecord.create({
					tenantId: tenant.id,
					generationId: attempt.generationId,
					attempt: attempt.attempt,
					userId,
					provider: attempt.provider,
					model: attempt.model,
					units: 1,
					estimatedCredits:
						creditsPerImage === null ? null : creditsPerImage.toFixed(3),
					status: "reserved",
					reservedAt: now,
				});
			}
		});
	}

	/** Settles a reserved attempt once its image is stored: true when it did. */
	async settle(
		tenant: TenantRef,
		generationId: string,
		attempt: number,
		actualCredits: number | null,
	): Promise<boolean> {
		const changed = await DesignUsageRecord.query()
			.where("tenant_id", tenant.id)
			.where("generation_id", generationId)
			.where("attempt", attempt)
			.where("status", "reserved")
			.update({
				status: "settled",
				settled_at: new Date(),
				...(actualCredits === null
					? {}
					: { actual_credits: actualCredits.toFixed(3) }),
			});
		return Number(changed[0] ?? 0) > 0;
	}

	/** Releases a reserved attempt (failed, moderated, refused): true when it did. */
	async release(
		tenant: TenantRef,
		generationId: string,
		attempt: number,
		reason: string,
		actualCredits: number | null = null,
	): Promise<boolean> {
		const changed = await DesignUsageRecord.query()
			.where("tenant_id", tenant.id)
			.where("generation_id", generationId)
			.where("attempt", attempt)
			.where("status", "reserved")
			.update({
				status: "released",
				released_at: new Date(),
				release_reason: reason,
				...(actualCredits === null
					? {}
					: { actual_credits: actualCredits.toFixed(3) }),
			});
		return Number(changed[0] ?? 0) > 0;
	}

	private limitNow() {
		const { monthlyLimit, creditsPerImage } = designLabSettings();
		return { limit: monthlyLimit, creditsPerImage };
	}

	private async monthCounts(tenant: TenantRef, now: DateTime) {
		const rows = (await DesignUsageRecord.query()
			.where("tenant_id", tenant.id)
			.where("reserved_at", ">=", monthStart(now).toJSDate())
			.groupBy("status")
			.select("status")
			.sum("units as total_units")) as unknown as {
			status: string;
			$extras: { total_units: string | number };
		}[];
		const count = (status: string) =>
			Number(
				rows.find((row) => row.status === status)?.$extras.total_units ?? 0,
			);
		return {
			reserved: count("reserved"),
			settled: count("settled"),
			released: count("released"),
		};
	}
}

/** The first instant of `now`'s calendar month, UTC. */
export function monthStart(now: DateTime): DateTime {
	return now.toUTC().startOf("month");
}
