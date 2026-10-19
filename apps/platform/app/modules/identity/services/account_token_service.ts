import {
	hashAccountToken,
	isFlowId,
	newAccountToken,
	TOKEN_MINUTES,
	type TokenPurpose,
} from "#modules/identity/account_tokens";
import { dbClient } from "#services/db_context";

export type TokenState =
	/** `flow` is the token row's id, for the page's hidden field (see `FLOW_FIELD`). */
	| { state: "live"; userId: string; email: string; flow: string }
	| { state: "expired" }
	| { state: "unknown" };

/**
 * The `account_tokens` table (TAT-18): one live token per account and
 * purpose, stored as its SHA-256 only, bound to the address it was sent to.
 * Raw SQL through dbClient(), so each statement joins the open transaction
 * and the replace and the single use are one statement each.
 */
export default class AccountTokenService {
	/**
	 * A new token for the account's current address. It replaces the
	 * account's older token of this purpose, whose link stops working.
	 */
	async issue(
		user: { id: string; email: string },
		purpose: TokenPurpose,
	): Promise<string> {
		const token = newAccountToken();
		await dbClient().rawQuery(
			`insert into account_tokens (user_id, purpose, token_hash, email, expires_at, created_at)
			 values (?, ?, ?, ?, now() + make_interval(mins => ?), now())
			 on conflict (user_id, purpose) do update
			 set token_hash = excluded.token_hash, email = excluded.email,
			     expires_at = excluded.expires_at, created_at = excluded.created_at`,
			[
				user.id,
				purpose,
				hashAccountToken(token),
				user.email,
				TOKEN_MINUTES[purpose],
			],
		);
		return token;
	}

	/**
	 * What a link's page shows: live (its account and address), expired, or
	 * unknown (used, replaced, of another purpose or never issued).
	 */
	async state(token: string, purpose: TokenPurpose): Promise<TokenState> {
		const { rows } = await dbClient().rawQuery(
			"select id, user_id, email, expires_at > now() as live from account_tokens where token_hash = ? and purpose = ?",
			[hashAccountToken(token), purpose],
		);
		const row = rows[0] as
			| { id: string; user_id: string; email: string; live: boolean }
			| undefined;
		if (!row) return { state: "unknown" };
		if (!row.live) return { state: "expired" };
		return {
			state: "live",
			userId: row.user_id,
			email: row.email,
			flow: row.id,
		};
	}

	/**
	 * Uses a live token: deletes it and returns its account and address.
	 * One statement, so two requests with one token get it once. `flow` is
	 * the id of the row the form was shown for (see `state`): another row's
	 * id, or anything that isn't an id, finds nothing, like a dead link.
	 */
	async consume(
		token: string,
		purpose: TokenPurpose,
		flow: string,
	): Promise<{ userId: string; email: string } | null> {
		if (!isFlowId(flow)) return null;
		const { rows } = await dbClient().rawQuery(
			"delete from account_tokens where token_hash = ? and purpose = ? and id = ? and expires_at > now() returning user_id, email",
			[hashAccountToken(token), purpose, flow],
		);
		const row = rows[0] as { user_id: string; email: string } | undefined;
		return row ? { userId: row.user_id, email: row.email } : null;
	}

	/** Deletes the account's token of this purpose, if any. */
	async revoke(userId: string, purpose: TokenPurpose): Promise<void> {
		await dbClient().rawQuery(
			"delete from account_tokens where user_id = ? and purpose = ?",
			[userId, purpose],
		);
	}
}
