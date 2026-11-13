import { BaseSchema } from "@adonisjs/lucid/schema";
import {
	disableTenantRls,
	enableTenantRls,
	tenantReference,
} from "#database/helpers/tenant_rls";
import env from "#start/env";

/**
 * Reviews and Fresh ink, slice 1's review fixes (a new migration rather than
 * an edit of 1791920000000, so a database that ran it moves forward):
 *
 * - The client's delete scrubs what they wrote: a deleted review keeps no
 *   rating, text or name (`rating` may be null, `body` and `shown_name`
 *   empty, only once `deleted_at` is set); a deleted post no caption,
 *   placement, styles or name. Ids, dates and any takedown record stay.
 * - A shown name may hold no bidi control (U+202A to U+202E, U+2066 to
 *   U+2069) or zero-width character (U+200B to U+200D, U+FEFF), and is not
 *   blank after trimming (the validator's rule, `client_*_shown_name`).
 * - A draft post (`submitted_at` null) is `waiting`; a takedown note needs
 *   a takedown.
 * - Disputes: `submitter_digest` (an HMAC of the submitter's address and
 *   user agent, #modules/reviews/submitters) and `submitter_recorded_at`,
 *   both or neither; never public, cleared after 90 days by the sweep that
 *   reads `stale_submitter_tenants()`.
 * - `client_video_reservations`: a signed, unfinished client video upload
 *   holds one of the post's places for its hour (ClientPostService.signVideo).
 * - `stuck_client_video_candidates()`: the stuck-video sweep for client
 *   videos, the shape of `stuck_video_candidates()` (1791910000002).
 *
 * The functions' bodies read `client_post_media.tenant_id`, `id`, `kind`,
 * `video_state`, `created_at` and the two tables' `tenant_id` and
 * `submitter_recorded_at`: a migration that drops or retypes one of them
 * replaces the function in the same migration.
 */
const NAME_RULE =
	"char_length(shown_name) between 1 and 40 and btrim(shown_name) <> '' and shown_name !~ '[\\u200B-\\u200D\\u202A-\\u202E\\u2066-\\u2069\\uFEFF]'";

export default class extends BaseSchema {
	async up() {
		const appRole = `"${env.get("DB_USER").replaceAll('"', '""')}"`;
		const statements = [
			// Reviews: the delete's scrub, the name rule, the note, the digest.
			"alter table client_reviews alter column rating drop not null",
			"alter table client_reviews drop constraint client_reviews_rating",
			"alter table client_reviews add constraint client_reviews_rating check ((rating is null and deleted_at is not null) or rating between 1 and 5)",
			"alter table client_reviews drop constraint client_reviews_body_length",
			"alter table client_reviews add constraint client_reviews_body_length check ((deleted_at is not null and body = '') or char_length(body) between 20 and 2000)",
			"alter table client_reviews drop constraint client_reviews_shown_name_length",
			`alter table client_reviews add constraint client_reviews_shown_name check ((deleted_at is not null and shown_name = '') or (${NAME_RULE}))`,
			"alter table client_reviews add constraint client_reviews_takedown_note check (takedown_note is null or taken_down_at is not null)",
			"alter table client_reviews add column submitter_digest varchar(64) null, add column submitter_recorded_at timestamptz null",
			"alter table client_reviews add constraint client_reviews_submitter check ((submitter_digest is null) = (submitter_recorded_at is null) and (submitter_digest is null or submitter_digest ~ '^[0-9a-f]{64}$'))",
			"create index client_reviews_submitter_recorded on client_reviews (submitter_recorded_at) where submitter_recorded_at is not null",
			// Posts: the same, and a draft is waiting.
			"alter table client_posts drop constraint client_posts_shown_name_length",
			`alter table client_posts add constraint client_posts_shown_name check ((deleted_at is not null and shown_name = '') or (${NAME_RULE}))`,
			"alter table client_posts add constraint client_posts_draft_waiting check (submitted_at is not null or status = 'waiting')",
			"alter table client_posts add constraint client_posts_takedown_note check (takedown_note is null or taken_down_at is not null)",
			"alter table client_posts add column submitter_digest varchar(64) null, add column submitter_recorded_at timestamptz null",
			"alter table client_posts add constraint client_posts_submitter check ((submitter_digest is null) = (submitter_recorded_at is null) and (submitter_digest is null or submitter_digest ~ '^[0-9a-f]{64}$'))",
			"create index client_posts_submitter_recorded on client_posts (submitter_recorded_at) where submitter_recorded_at is not null",
			// The stuck-video sweep for client videos.
			"create index client_post_media_processing_videos on client_post_media (created_at) where video_state = 'processing'",
			`create function public.stuck_client_video_candidates()
returns table (tenant_id uuid, media_id uuid)
language sql stable security definer
set search_path = pg_catalog, pg_temp
begin atomic
  select m.tenant_id, m.id
  from public.client_post_media m
  where m.kind = 'video'
    and m.video_state = 'processing'
    and m.created_at <= statement_timestamp() - interval '60 minutes'
  order by m.created_at, m.id
  limit 500;
end`,
			"revoke all on function public.stuck_client_video_candidates() from public",
			`grant execute on function public.stuck_client_video_candidates() to ${appRole}`,
			// The disputes record's 90 days.
			`create function public.stale_submitter_tenants()
returns table (tenant_id uuid)
language sql stable security definer
set search_path = pg_catalog, pg_temp
begin atomic
  select t.tenant_id from (
    select r.tenant_id from public.client_reviews r
    where r.submitter_recorded_at <= statement_timestamp() - interval '90 days'
    union
    select p.tenant_id from public.client_posts p
    where p.submitter_recorded_at <= statement_timestamp() - interval '90 days'
  ) t
  order by t.tenant_id
  limit 500;
end`,
			"revoke all on function public.stale_submitter_tenants() from public",
			`grant execute on function public.stale_submitter_tenants() to ${appRole}`,
		];
		for (const statement of statements) this.schema.raw(statement);

		this.schema.createTable("client_video_reservations", (table) => {
			table.uuid("id").primary().defaultTo(this.raw("uuidv7()"));
			table
				.uuid("tenant_id")
				.notNullable()
				.references("id")
				.inTable("tenants")
				.onDelete("CASCADE");
			table.uuid("post_id").notNullable();
			table.string("staging_key", 255).notNullable();
			table.timestamp("created_at", { useTz: true }).notNullable();
			table.timestamp("expires_at", { useTz: true }).notNullable();
			tenantReference(table, "post_id", "client_posts");
			table.unique(["tenant_id", "staging_key"]);
			table.index(["tenant_id", "post_id"]);
		});
		for (const sql of enableTenantRls("client_video_reservations")) {
			this.schema.raw(sql);
		}
	}

	async down() {
		// The old checks have no place for a scrubbed row or a nameless one.
		this.schema.raw(`do $$ begin
	if exists (select 1 from client_reviews where rating is null or body = '' or shown_name = '')
		or exists (select 1 from client_posts where shown_name = '') then
		raise exception 'scrubbed reviews or posts exist: delete them before rolling back';
	end if;
end $$`);
		for (const sql of disableTenantRls("client_video_reservations")) {
			this.schema.raw(sql);
		}
		this.schema.dropTable("client_video_reservations");
		for (const statement of [
			"drop function public.stale_submitter_tenants()",
			"drop function public.stuck_client_video_candidates()",
			"drop index client_post_media_processing_videos",
			"drop index client_posts_submitter_recorded",
			"alter table client_posts drop constraint client_posts_submitter",
			"alter table client_posts drop column submitter_recorded_at, drop column submitter_digest",
			"alter table client_posts drop constraint client_posts_takedown_note",
			"alter table client_posts drop constraint client_posts_draft_waiting",
			"alter table client_posts drop constraint client_posts_shown_name",
			"alter table client_posts add constraint client_posts_shown_name_length check (char_length(shown_name) between 1 and 40)",
			"drop index client_reviews_submitter_recorded",
			"alter table client_reviews drop constraint client_reviews_submitter",
			"alter table client_reviews drop column submitter_recorded_at, drop column submitter_digest",
			"alter table client_reviews drop constraint client_reviews_takedown_note",
			"alter table client_reviews drop constraint client_reviews_shown_name",
			"alter table client_reviews add constraint client_reviews_shown_name_length check (char_length(shown_name) between 1 and 40)",
			"alter table client_reviews drop constraint client_reviews_body_length",
			"alter table client_reviews add constraint client_reviews_body_length check (char_length(body) between 20 and 2000)",
			"alter table client_reviews drop constraint client_reviews_rating",
			"alter table client_reviews add constraint client_reviews_rating check (rating between 1 and 5)",
			"alter table client_reviews alter column rating set not null",
		]) {
			this.schema.raw(statement);
		}
	}
}
