import { BaseSchema } from "@adonisjs/lucid/schema";
import env from "#start/env";

/**
 * Video angles: the stuck-video sweep (SweepStuckVideosJob). A video stays
 * `processing` only while its job runs; a worker that died with it, or a job
 * that was lost, would leave it there for good. Every 10 minutes the sweep
 * lists, across tenants, the videos still processing an hour after they were
 * added (`stuck_video_candidates()`: ids only, the database README's rules
 * for a SECURITY DEFINER function, like expired_quote_candidates()) and
 * queues one FailStuckVideoJob per row, in that row's tenant, which fails it
 * under its lock ("Took too long to process. Upload it again.") and deletes
 * its upload. The hour is STUCK_AFTER_MINUTES in #modules/media/video: keep
 * the two equal (stuck_video_candidates.spec.ts pins it). At most 500 a run.
 *
 * The body reads `artist_work_photos.tenant_id`, `id`, `kind`,
 * `video_state` and `created_at`: a migration that drops or retypes one of
 * them must replace the function in the same migration. A partial index
 * keeps the read to the processing rows.
 */
export default class extends BaseSchema {
	async up() {
		const appRole = `"${env.get("DB_USER").replaceAll('"', '""')}"`;
		const statements = [
			"create index artist_work_photos_processing_videos on artist_work_photos (created_at) where video_state = 'processing'",
			`create function public.stuck_video_candidates()
returns table (tenant_id uuid, photo_id uuid)
language sql stable security definer
set search_path = pg_catalog, pg_temp
begin atomic
  select p.tenant_id, p.id
  from public.artist_work_photos p
  where p.kind = 'video'
    and p.video_state = 'processing'
    and p.created_at <= statement_timestamp() - interval '60 minutes'
  order by p.created_at, p.id
  limit 500;
end`,
			"revoke all on function public.stuck_video_candidates() from public",
			`grant execute on function public.stuck_video_candidates() to ${appRole}`,
		];
		for (const statement of statements) this.schema.raw(statement);
	}

	async down() {
		this.schema.raw("drop function public.stuck_video_candidates()");
		this.schema.raw("drop index artist_work_photos_processing_videos");
	}
}
