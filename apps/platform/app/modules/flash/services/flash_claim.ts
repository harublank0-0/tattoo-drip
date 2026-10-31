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
 * - The claim moment is the project's first qualifying event: its first
 *   verified deposit (verified from a screenshot or recorded at the desk)
 *   or its becoming booked, whichever comes first. PaymentService.afterPayment
 *   and SessionService.moveToBooked call this at every such event; nothing
 *   else does. Only the first one tries: it marks the project
 *   (`tattoo_projects.flash_claimed_once_at`, one conditional UPDATE under the
 *   project's lock) whatever the outcome, and a later call finds the mark and
 *   returns false. So the rest of a split deposit, or the booking after the
 *   first deposit, never takes back a design the studio made available
 *   (FlashService.setClaimed) after the first event claimed it.
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
 * transaction (`dbClient()`), under the project's row lock, so a claim
 * commits with the deposit or the booking that caused it.
 *
 * Lock order. The studio's writes on a design take the artist's row first
 * (`lockEditable`, `holdVisible`) and the design's row after; a claim takes
 * the project's row first (the caller's lock) and then the design's row (and
 * never an artist's row, so it adds no wait on one). A write that took the
 * design's row and then waited for a project's would meet it in a cycle:
 * FlashService.remove therefore asks first whether a request or project
 * names the design (`isNamed`, a plain read) before it deletes the row. A
 * hide or a hand claim (`update`, `setClaimed`) waits for an in-flight claim
 * on the design's row and then changes only its own columns, never the
 * claim's. An intake holds the design `FOR SHARE` (FlashService.holdShown):
 * a claim waits for a request that holds it, and a request waits for a claim
 * in flight and then sees the design claimed, so a request that gets in is
 * stored before the claim and one that comes after is refused. The request
 * holds nothing a claim needs, so neither can wait for the other for long.
 */
export async function claimFlashFor(
	tenant: TenantRef,
	project: Pick<TattooProject, "id" | "flashDesignId">,
): Promise<boolean> {
	if (!project.flashDesignId) return false;
	// The project's own row, locked by the caller: the first qualifying event
	// takes the mark, a later one gets no row back. A SQL gate, not the
	// caller's copy of the row, which a first call made in the same
	// transaction has already made stale.
	const first = await dbClient().rawQuery(
		`update tattoo_projects set flash_claimed_once_at = now()
		where tenant_id = ? and id = ? and flash_claimed_once_at is null`,
		[tenant.id, project.id],
	);
	if (first.rowCount === 0) return false;
	const result = await dbClient().rawQuery(
		`update flash_designs
		set claimed_at = now(), claimed_project_id = ?, updated_at = now()
		where tenant_id = ? and id = ? and one_of_a_kind and claimed_at is null`,
		[project.id, tenant.id, project.flashDesignId],
	);
	return result.rowCount > 0;
}
