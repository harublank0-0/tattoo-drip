/**
 * SQL that keeps a row only while its artist is, in this very statement, a
 * live visible artist of the tenant (one `?`: the tenant's id). `table` is
 * the name the query gives the row's table, which has an `artist_id`.
 *
 * The public reads get artist ids that were read earlier, and under READ
 * COMMITTED an artist can be hidden or deleted between that read and the
 * rows'; asking again in the same SQL means a cacheable response never
 * carries a row of an artist who is no longer shown. `artists` is
 * soft-deleted, so `deleted_at` is said here (the model's scope is a fetch
 * hook and does not reach a subquery). `table` is always a fixed name in
 * code, never input.
 */
export function visibleArtistSql(table: string): string {
	return `exists (
	select 1 from artists
	where artists.id = ${table}.artist_id
		and artists.tenant_id = ?
		and artists.visible
		and artists.deleted_at is null
)`;
}
