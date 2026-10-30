import type TattooProject from "#modules/projects/models/tattoo_project";
import type Tenant from "#modules/tenancy/models/tenant";
import { dbClient } from "#services/db_context";

type TenantRef = Pick<Tenant, "id">;

/**
 * Claims the project's flash design, if it is one of a kind and still free
 * (TAT-129, part 4b). One conditional UPDATE, so the first claim to commit
 * wins and a second changes nothing: `claimed_at is null` is the whole race.
 * It returns true when it changed a row.
 *
 * The rules, in one place:
 * - The claim moments are the project's first verified deposit (verified from
 *   a screenshot or recorded at the desk) and the project becoming booked,
 *   whichever comes first. PaymentService.afterPayment and
 *   SessionService.moveToBooked call this; nothing else does.
 * - A design that can be tattooed again (`one_of_a_kind` false) is never
 *   claimed; neither is a design someone already claimed, by a project or by
 *   hand (FlashService.setClaimed). A project with no design costs no query.
 * - Nothing here ever releases a claim. A reversed or refunded deposit, a
 *   withdrawn, declined or cancelled project keep it; only "Make available"
 *   (FlashService.setClaimed) or switching the design to "can be tattooed
 *   again" (FlashService.update) release it, because the studio talks to
 *   the client first.
 * - It never changes a status, a payment or a deposit link: a claim only
 *   warns the studio about the other open requests and projects.
 *
 * It is a function, not a FlashService method, so PaymentService and
 * SessionService keep their constructors. It runs on the caller's
 * transaction (`dbClient()`), under the project's lock, so a claim commits
 * with the deposit or the booking that caused it. The design's row is not
 * locked first: no artist lock is taken, so there is no new lock order (the
 * artist-then-design order of FlashService.remove and the intake hold is
 * unchanged, and a claim only ever updates a design row it did not lock
 * before; a removal waits on the project's foreign key, never the reverse).
 */
export async function claimFlashFor(
	tenant: TenantRef,
	project: Pick<TattooProject, "id" | "flashDesignId">,
): Promise<boolean> {
	if (!project.flashDesignId) return false;
	const result = await dbClient().rawQuery(
		`update flash_designs
		set claimed_at = now(), claimed_project_id = ?, updated_at = now()
		where tenant_id = ? and id = ? and one_of_a_kind and claimed_at is null`,
		[project.id, tenant.id, project.flashDesignId],
	);
	return result.rowCount > 0;
}
