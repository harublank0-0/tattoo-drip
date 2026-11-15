import { inject } from "@adonisjs/core";
import logger from "@adonisjs/core/services/logger";
import { DateTime } from "luxon";
import { bundleIdsByKey } from "#modules/packages/bundles";
import PilotGrant from "#modules/packages/models/pilot_grant";
import { PACKAGES, type PackageKey } from "#modules/packages/packages";
import type Tenant from "#modules/tenancy/models/tenant";
import { dbClient, withDbContext } from "#services/db_context";

/** A refused grant, in words for the operator's terminal. */
export class PilotGrantError extends Error {}

/**
 * Pilot grants (docs/superpowers/specs/2026-11-15-studio-packages-design.md,
 * ruling 7): pilots get an explicit, temporary package until their agreed
 * transition date, so they are never paused by accident when enforcement
 * ships. Set by an operator (`node ace packages:pilot`), in the studio's own
 * row-level-security context; the only cross-studio step is finding the
 * studio by its slug (`tenant_for_slug`).
 */
@inject()
export default class PilotGrantService {
	/**
	 * Grants `input.package` to the studio using `slug`, from `now` until
	 * `input.endsAt`, with the package's default allowance bundle. A grant
	 * still running ends at `now`, so at most one runs.
	 */
	async grant(
		slug: string,
		input: { package: PackageKey; endsAt: DateTime; note: string },
		now: DateTime = DateTime.utc(),
	): Promise<PilotGrant> {
		const note = input.note.trim();
		if (note.length < 1 || note.length > 500) {
			throw new PilotGrantError("Give a note of 1 to 500 characters.");
		}
		if (input.endsAt <= now) {
			throw new PilotGrantError("The grant must end after now.");
		}
		const { rows } = await dbClient().rawQuery(
			"select public.tenant_for_slug(?) as id",
			[slug],
		);
		const tenantId: string | null = rows[0]?.id ?? null;
		if (!tenantId) throw new PilotGrantError(`No studio uses "${slug}".`);
		const bundleKey = PACKAGES[input.package].defaultBundleKey;
		const bundleId = (await bundleIdsByKey([bundleKey])).get(
			bundleKey,
		) as string;

		return withDbContext({ tenantId }, async (trx) => {
			const at = now.toUTC().toISO() as string;
			await trx.rawQuery(
				`update pilot_grants set ends_at = ?
				 where tenant_id = ? and starts_at <= ? and ends_at > ?`,
				[at, tenantId, at, at],
			);
			const grant = await PilotGrant.create(
				{
					tenantId,
					package: input.package,
					allowanceBundleId: bundleId,
					startsAt: now,
					endsAt: input.endsAt,
					note,
				},
				{ client: trx },
			);
			logger.info(
				{ tenantId, package: input.package, endsAt: at },
				"Pilot grant recorded",
			);
			return grant;
		});
	}

	/** The studio's grants, oldest first, read in the caller's (the studio's) context. */
	async forTenant(tenant: Pick<Tenant, "id">): Promise<PilotGrant[]> {
		return PilotGrant.query()
			.where("tenant_id", tenant.id)
			.orderBy("starts_at")
			.orderBy("id");
	}
}
