import { inject } from "@adonisjs/core";
import logger from "@adonisjs/core/services/logger";
import { DateTime } from "luxon";
import DesignUsageRecord from "#modules/design_lab/models/design_usage_record";
import { designLabSettings } from "#modules/design_lab/settings";
import AllowanceBundle from "#modules/packages/models/allowance_bundle";
import { PACKAGES, type PackageKey } from "#modules/packages/packages";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import EntitlementService from "#modules/packages/services/entitlement_service";
import { packageEnforcement } from "#modules/packages/settings";
import { formatDay } from "#modules/projects/quotes";
import type Tenant from "#modules/tenancy/models/tenant";
import { withTransaction } from "#services/db_context";

type TenantRef = Pick<Tenant, "id">;

/**
 * The studio has no generations left this month (ruling 12: name the
 * blocked action, say what still works, give a real next step). Studio is
 * offered only when its bundle gives more (`studioLimit`).
 */
export class AllowanceError extends Error {
	constructor(
		readonly remaining: number,
		readonly limit: number,
		resetsAt: DateTime,
		studioLimit: number | null,
	) {
		super(
			remaining === 0
				? `Your studio has used all ${limit} generations for this month. New generations are paused until ${formatDay(resetsAt.toUTC().toISODate() as string)}; your designs and history stay available.${studioLimit === null ? "" : ` The Studio package includes ${studioLimit} a month.`}`
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
	/** The limit in force (see DesignUsageService). */
	limit: number;
	/** The studio's package bundle's images a month, whatever the mode; null when not metered. */
	packageLimit: number | null;
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
 * provider; each studio may start its limit of generations a calendar month
 * (UTC). The limit in force (the image meter, studio packages phase 5): 0 in
 * DESIGN_LAB_MONTHLY_LIMIT turns generation off everywhere; otherwise, with
 * enforcement on, the studio's package bundle's `images_per_month`; else (in
 * observe mode, or a bundle not metered) DESIGN_LAB_MONTHLY_LIMIT, and a
 * request the bundle would refuse is logged ("Package rule would refuse").
 * Every accepted generation attempt is one ledger row:
 * `reserved` when accepted (counted at once, so the limit holds while the
 * worker runs), `settled` once its image is stored, `released` (not counted)
 * when the provider failed, refused or moderated it. Settling and releasing
 * change only a `reserved` row, so a repeated job or retry never counts
 * twice, and reservations take a per-studio advisory lock, so two submits at
 * once cannot both take the last generation. Nothing the browser sends
 * decides a count, a cost or the limit.
 */
@inject()
export default class DesignUsageService {
	constructor(private entitlements: EntitlementService) {}

	/** The studio's allowance this month. */
	async allowance(tenant: TenantRef, now = DateTime.utc()): Promise<Allowance> {
		const { limit, packageLimit } = await this.limitsFor(tenant, now);
		const counts = await this.monthCounts(tenant, now);
		return {
			limit,
			packageLimit,
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
			const limits = await this.limitsFor(tenant, now);
			const { limit, creditsPerImage } = limits;
			const counts = await this.monthCounts(tenant, now);
			const used = counts.settled + counts.reserved;
			const remaining = Math.max(0, limit - used);
			if (attempts.length > remaining) {
				throw new AllowanceError(
					remaining,
					limit,
					monthStart(now).plus({ months: 1 }),
					limits.studioLimit,
				);
			}
			if (
				packageEnforcement() === "observe" &&
				limits.packageLimit !== null &&
				attempts.length > Math.max(0, limits.packageLimit - used)
			) {
				logger.info(
					{
						tenantId: tenant.id,
						rule: "image_allowance",
						package: limits.package,
						packageLimit: limits.packageLimit,
						used,
						requested: attempts.length,
					},
					"Package rule would refuse",
				);
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

	/**
	 * The limit in force for the studio now, its package bundle's number
	 * (whatever the mode), and Studio's number when offering Studio would give
	 * more (enforce mode, a Solo studio). Reads run in the studio's context.
	 */
	private async limitsFor(
		tenant: TenantRef,
		now: DateTime,
	): Promise<{
		limit: number;
		packageLimit: number | null;
		package: PackageKey;
		studioLimit: number | null;
		creditsPerImage: number | null;
	}> {
		const { monthlyLimit, creditsPerImage } = designLabSettings();
		const entitlement = await this.entitlements.for(tenant, now);
		const bundle = await AllowanceBundle.find(entitlement.bundleId);
		const packageLimit = bundle?.imagesPerMonth ?? null;
		const enforced = packageEnforcement() === "enforce";
		// 0 in the setting is the documented off switch, whatever a bundle says.
		const limit =
			monthlyLimit === 0
				? 0
				: enforced && packageLimit !== null
					? packageLimit
					: monthlyLimit;
		let studioLimit: number | null = null;
		if (enforced && entitlement.package === "solo") {
			const studio = await AllowanceBundle.findBy(
				"key",
				PACKAGES.studio.defaultBundleKey,
			);
			const offered = studio?.imagesPerMonth ?? null;
			if (offered !== null && offered > limit) studioLimit = offered;
		}
		return {
			limit,
			packageLimit,
			package: entitlement.package,
			studioLimit,
			creditsPerImage,
		};
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
