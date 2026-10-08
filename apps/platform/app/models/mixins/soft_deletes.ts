import type { NormalizeConstructor } from "@adonisjs/core/types/helpers";
import {
	type BaseModel,
	beforeFetch,
	beforeFind,
	beforePaginate,
} from "@adonisjs/lucid/orm";
import type { TransactionClientContract } from "@adonisjs/lucid/types/database";
import type {
	LucidModel,
	ModelQueryBuilderContract,
} from "@adonisjs/lucid/types/model";
import { DateTime } from "luxon";

const TRASHED = Symbol("softDeletes.trashed");

type TrashedMode = "with" | "only";
type SoftDeleteQuery = ModelQueryBuilderContract<LucidModel> & {
	[TRASHED]?: TrashedMode;
};

function filterTrashed(query: SoftDeleteQuery, mode?: TrashedMode) {
	const column = `${query.model.table}.deleted_at`;
	if (mode === "with") return;
	if (mode === "only") query.whereNotNull(column);
	else query.whereNull(column);
}

/**
 * Soft delete for business records: `softDelete()` stamps `deleted_at`
 * instead of removing the row, and every model query skips deleted rows
 * unless it starts from `withTrashed()` or `onlyTrashed()`.
 *
 * The table needs a nullable `deleted_at timestamptz` column. Raw queries
 * (`db.from(...)`) bypass this; add `whereNull("deleted_at")` there.
 */
export function withSoftDeletes<
	Model extends NormalizeConstructor<typeof BaseModel>,
>(superclass: Model) {
	class SoftDeletes extends superclass {
		declare deletedAt: DateTime | null;

		@beforeFind()
		@beforeFetch()
		static skipTrashed(query: SoftDeleteQuery) {
			filterTrashed(query, query[TRASHED]);
		}

		/**
		 * Pagination runs a cloned count query alongside the main one; apply
		 * the main query's mode to both so the total matches the rows.
		 */
		@beforePaginate()
		static skipTrashedInPage([countQuery, query]: [
			SoftDeleteQuery,
			SoftDeleteQuery,
		]) {
			filterTrashed(countQuery, query[TRASHED]);
			filterTrashed(query, query[TRASHED]);
		}

		/**
		 * A query that includes soft-deleted rows.
		 */
		static withTrashed<T extends typeof SoftDeletes>(this: T) {
			// biome-ignore lint/complexity/noThisInStatic: `this` is the model the mixin is applied to (Tenant…); the mixin class itself has no table.
			const query = this.query();
			(query as unknown as SoftDeleteQuery)[TRASHED] = "with";
			return query;
		}

		/**
		 * A query that returns only soft-deleted rows.
		 */
		static onlyTrashed<T extends typeof SoftDeletes>(this: T) {
			// biome-ignore lint/complexity/noThisInStatic: `this` is the model the mixin is applied to (Tenant…); the mixin class itself has no table.
			const query = this.query();
			(query as unknown as SoftDeleteQuery)[TRASHED] = "only";
			return query;
		}

		async softDelete(trx?: TransactionClientContract) {
			// biome-ignore lint/correctness/useHookAtTopLevel: Lucid's useTransaction, not a React hook.
			if (trx) this.useTransaction(trx);
			this.deletedAt = DateTime.utc();
			await this.save();
		}

		async restore(trx?: TransactionClientContract) {
			// biome-ignore lint/correctness/useHookAtTopLevel: Lucid's useTransaction, not a React hook.
			if (trx) this.useTransaction(trx);
			this.deletedAt = null;
			await this.save();
		}
	}

	return SoftDeletes;
}
